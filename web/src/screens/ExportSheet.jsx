// Export: direct sending to a calendar (the phone's calendar in the Android app, or a hosted
// Google Calendar connector) or .ics files, then marking the events as exported.
import { useState, useEffect, useMemo, useRef } from "preact/hooks";
import { t } from "../i18n/index.js";
import { formatDateShort } from "../lib/dates.js";
import { markExported } from "../lib/events.js";
import { GCAL_SERVER, createdEventId, gcalEventPayload, parseCalendarList } from "../lib/gcal.js";
import { haptic } from "../lib/haptics.js";
import { canShareFiles, getHost, saveFile, shareFile } from "../lib/host.js";
import { buildIcs, exportFiles, fileSlug } from "../lib/ics.js";
import { getState, undo, updateState } from "../lib/store.js";
import { checkEvents, sortEvents } from "../lib/timing.js";
import { makeZip } from "../lib/zip.js";
import { Icon } from "../ui/Icon.jsx";
import { toast } from "../ui/Overlays.jsx";
import { Sheet } from "../ui/Sheet.jsx";
import { Button, Field, Segmented, Select, Toggle, contrastText } from "../ui/components.jsx";

// Connector errors that make further attempts pointless.
const FATAL_ERRORS = ["needs_reauth", "server_not_connected", "not_in_manifest", "approval_required"];

function ImportGuide({ grouping }) {
  const [open, setOpen] = useState(false);
  return (
    <div class="guide">
      <button type="button" class="guide-h" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon n="info" size={16} /> {t("export.guide.title")}
        <Icon n={open ? "chevU" : "chevD"} size={16} />
      </button>
      {open && (
        <ol class="guide-b">
          <li>{t("export.guide.step1")}</li>
          {grouping !== "single" && <li>{t("export.guide.step2")}</li>}
          <li>{t("export.guide.step3")}</li>
          <li>{t("export.guide.step4")}</li>
        </ol>
      )}
    </div>
  );
}

export function ExportSheet({ events, scope, autoSend = false, onClose, onExported }) {
  const initial = getState();
  const [host, setHost] = useState(null);
  const [method, setMethod] = useState(null);
  const [includeDone, setIncludeDone] = useState(false);
  const [grouping, setGrouping] = useState(initial.settings.exportGrouping || "perColor");
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(null);
  const [calendars, setCalendars] = useState(null);
  const [calendarId, setCalendarId] = useState(initial.settings.gcalCalendarId || "");
  const [failures, setFailures] = useState([]);
  const [saved, setSaved] = useState(false);
  const autoSent = useRef(false);
  useEffect(() => {
    getHost().then((h) => {
      setHost(h);
      setMethod(h.gcal ? "gcal" : "ics");
    });
  }, []);
  const state = getState();
  const calName = state.settings.calName || "AgendApp";
  const target = host?.native ? t("export.target.phone") : t("export.target.google");
  const list = useMemo(
    () => sortEvents(state, includeDone && scope === "pending" ? state.events : events),
    [events, includeDone, scope],
  );
  const issues = useMemo(() => checkEvents(state, list), [list]);
  const issueCount = Object.keys(issues).length;
  const icsFiles = useMemo(() => {
    const now = new Date();
    return exportFiles(state, list, grouping, calName).map((file) => ({
      ...file,
      ics: buildIcs(state, file.events, { calName: file.calName, now }),
    }));
  }, [list, grouping, calName]);
  const first = list[0];
  const last = list[list.length - 1];
  const saveSettings = (patch) =>
    updateState((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }), { undo: false });
  const markDone = (ids, extra) => {
    updateState((prev) => markExported(prev, ids, extra), { label: t("undo.export") });
    onExported?.();
  };
  const saveFailed = (err) =>
    toast(t("export.saveFailed", { error: err?.message || err?.code || "?" }), { tone: "danger" });
  const downloadOne = async (file) => {
    try {
      // Claude-hosted pages only accept a few file types: .ics files are delivered zipped.
      const result = host?.downloads
        ? await saveFile(host, {
            filename: `${fileSlug(file.filename.replace(/\.ics$/, ""))}.zip`,
            data: new Blob([makeZip([{ name: file.filename, data: file.ics }])], { type: "application/zip" }),
          })
        : await saveFile(host, { filename: file.filename, data: file.ics, mime: "text/calendar;charset=utf-8" });
      if (result === "saved") {
        setSaved(true);
        haptic(12);
      }
    } catch (err) {
      saveFailed(err);
    }
  };
  const downloadAll = async () => {
    const blob = new Blob([makeZip(icsFiles.map((f) => ({ name: f.filename, data: f.ics })))], {
      type: "application/zip",
    });
    try {
      const filename = `${fileSlug(calName)}-agenda.zip`;
      if ((await saveFile(host, { filename, data: blob, mime: "application/zip" })) === "saved") {
        setSaved(true);
        haptic(12);
      }
    } catch (err) {
      saveFailed(err);
    }
  };
  const shareOne = async (file) => {
    const result = await shareFile({ filename: file.filename, data: file.ics, mime: "text/calendar" });
    if (result === "saved") {
      setSaved(true);
    } else if (result === "unsupported") {
      toast(t("export.shareUnavailable"));
    }
  };
  useEffect(() => {
    if (method !== "gcal" || !host?.mcp || calendars) {
      return;
    }
    host.mcp
      .callTool(GCAL_SERVER, "list_calendars", {})
      .then((result) => setCalendars(parseCalendarList(result.payload ?? result.content)))
      .catch((err) => {
        setCalendars([]);
        toast(t(err?.code === "needs_reauth" ? "export.error.reconnect" : "export.error.noCalendarList"));
      });
  }, [method]);
  const send = async () => {
    setSending(true);
    setFailures([]);
    const current = getState();
    saveSettings({ gcalCalendarId: calendarId });
    const jobs = list
      .map((ev) => ({
        ev,
        payload: gcalEventPayload(current, ev, {
          calendarId: calendarId || undefined,
          allDayEndExclusive: current.settings.allDayEndExclusive,
        }),
      }))
      .filter((job) => job.payload);
    setProgress({ done: 0, total: jobs.length });
    const sent = [];
    const ids = {};
    const failed = [];
    let next = 0;
    // Three sends at a time; a fatal error stops the queue.
    const worker = async () => {
      while (next < jobs.length) {
        const { ev, payload } = jobs[next++];
        try {
          const res = ev.gcalId
            ? await host.mcp.callTool(GCAL_SERVER, "update_event", { ...payload, eventId: ev.gcalId })
            : await host.mcp.callTool(GCAL_SERVER, "create_event", payload);
          const id = ev.gcalId || createdEventId(res.payload ?? res.content?.[0]?.text);
          sent.push(ev.id);
          ids[ev.id] = { gcalId: id || undefined, gcalCal: calendarId || "primary" };
        } catch (err) {
          failed.push({ id: ev.id, code: err?.code, msg: err?.message || String(err) });
          if (FATAL_ERRORS.includes(err?.code)) {
            next = jobs.length;
          }
        }
        setProgress((prev) => ({ ...prev, done: sent.length + failed.length }));
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (sent.length) {
      markDone(sent, ids);
    }
    setFailures(failed);
    setSending(false);
    if (!failed.length) {
      haptic(16);
      toast(t("export.sent", { n: sent.length, target }));
      onClose();
    }
  };
  useEffect(() => {
    if (autoSend && !autoSent.current && method === "gcal" && list.length) {
      autoSent.current = true;
      send();
    }
  }, [autoSend, method]);
  const errorText = (code) => (FATAL_ERRORS.includes(code) ? t(`export.error.${code}`) : null);
  const updateCount = list.filter((ev) => ev.gcalId).length;
  return (
    <Sheet
      onClose={onClose}
      tall={true}
      title={t("export.title")}
      subtitle={
        list.length
          ? `${t("common.events", { n: list.length })} · ${formatDateShort(first.date)}${last.date !== first.date ? " → " + formatDateShort(last.date) : ""}`
          : t("export.none")
      }
      footer={
        method === "gcal" ? (
          <Button kind="primary" block={true} icon="upload" disabled={sending || !list.length} onClick={send}>
            {sending
              ? t("export.sending", { done: progress?.done ?? 0, total: progress?.total ?? list.length })
              : t("export.send", { n: list.length, target })}
          </Button>
        ) : (
          <Button
            kind="primary"
            block={true}
            icon="download"
            disabled={!list.length || !icsFiles.length}
            onClick={downloadAll}
          >
            {icsFiles.length > 1 || host?.downloads
              ? t("export.downloadZip", { n: icsFiles.length })
              : t("export.downloadIcs")}
          </Button>
        )
      }
    >
      {host === null && <p class="muted">{t("common.loading")}</p>}
      {scope === "pending" && (
        <Toggle
          id="ex-done"
          checked={includeDone}
          onChange={setIncludeDone}
          label={t("export.includeDone")}
          hint={t("export.includeDoneHint")}
        />
      )}
      {issueCount > 0 && (
        <div class="callout warn">
          <Icon n="alert" size={18} />
          <div>
            <b>{t("export.issues", { n: issueCount })}</b>
            <ul>
              {Object.entries(issues)
                .slice(0, 4)
                .map(([id, msgs]) => (
                  <li key={id}>
                    {formatDateShort(list.find((ev) => ev.id === id)?.date || "2000-01-01")}
                    {" · "}
                    {msgs[0].text}
                  </li>
                ))}
            </ul>
            <small>{t("export.issuesHint")}</small>
          </div>
        </div>
      )}
      {host?.gcal && (
        <div class="blk">
          <Segmented
            value={method}
            onChange={setMethod}
            options={[
              { v: "gcal", label: target, sub: t("export.direct") },
              { v: "ics", label: t("export.icsFile"), sub: host.downloads ? "zip" : t("export.import") },
            ]}
          />
        </div>
      )}
      {method === "gcal" && (
        <>
          <p class="muted small">{t("export.directHint")}</p>
          <Field label={t("export.destination")} for="ex-cal">
            <Select
              id="ex-cal"
              value={calendarId}
              onChange={setCalendarId}
              options={[
                { v: "", label: t("export.primary") },
                ...(calendars || []).map((cal) => ({
                  v: cal.id,
                  label: cal.primary ? t("export.primaryNamed", { name: cal.name }) : cal.name,
                })),
              ]}
            />
          </Field>
          {updateCount > 0 && (
            <p class="muted small">
              <Icon n="repeat" size={14} /> {t("export.updates", { n: updateCount })}
            </p>
          )}
          {progress && sending && (
            <div class="bar">
              <i style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
            </div>
          )}
          {failures.length > 0 && (
            <div class="callout danger">
              <Icon n="alert" size={18} />
              <div>
                <b>{t("export.failed", { n: failures.length })}</b>
                <p>{errorText(failures[0].code) || failures[0].msg}</p>
                <small>{t("export.failedHint")}</small>
              </div>
            </div>
          )}
        </>
      )}
      {method === "ics" && (
        <>
          <div class="blk">
            <div class="cap">{t("export.split")}</div>
            <Segmented
              value={grouping}
              onChange={(value) => {
                setGrouping(value);
                saveSettings({ exportGrouping: value });
              }}
              options={[
                { v: "perColor", label: t("export.split.perColor") },
                { v: "single", label: t("export.split.single") },
                { v: "perType", label: t("export.split.perType") },
              ]}
            />
            <p class="muted small">{t(`export.split.${grouping}Hint`)}</p>
          </div>
          <div class="stack">
            {icsFiles.map((file) => (
              <div
                class="file"
                style={file.color ? { "--c": file.color.hex, "--ct": contrastText(file.color.hex) } : null}
                key={file.key}
              >
                {file.color && <i class="file-dot" />}
                <div class="file-m">
                  <strong>{file.calName}</strong>
                  <small>
                    {t("common.events", { n: file.events.length })} · {file.filename}
                  </small>
                  {file.color && grouping === "perColor" && (
                    <small>{t("export.calendarColor", { color: file.color.name })}</small>
                  )}
                </div>
                <div class="row gap-s">
                  {canShareFiles() && !host?.downloads && (
                    <button
                      type="button"
                      class="ibtn"
                      aria-label={t("export.share")}
                      onClick={() => shareOne(file)}
                    >
                      <Icon n="share" size={18} />
                    </button>
                  )}
                  <button
                    type="button"
                    class="ibtn"
                    aria-label={t("export.download")}
                    onClick={() => downloadOne(file)}
                  >
                    <Icon n="download" size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {host?.downloads && (
            <p class="muted small">
              <Icon n="info" size={14} /> {t("export.zipHint")}
            </p>
          )}
          <ImportGuide grouping={grouping} />
        </>
      )}
      <p class="muted small">
        <Icon n="gear" size={14} /> {t("export.settingsHint")}
      </p>
      {saved && (
        <div class="callout ok">
          <Icon n="check" size={18} />
          <div>
            <b>{t("export.saved")}</b>
            <p>{t("export.markQuestion", { n: list.length })}</p>
            <div class="row gap-s">
              <Button
                small={true}
                kind="primary"
                onClick={() => {
                  markDone(list.map((ev) => ev.id));
                  toast(t("export.marked"), { action: { label: t("common.undo"), run: undo } });
                  onClose();
                }}
              >
                {t("export.markYes")}
              </Button>
              <Button small={true} kind="ghost" onClick={() => setSaved(false)}>
                {t("export.later")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Sheet>
  );
}
