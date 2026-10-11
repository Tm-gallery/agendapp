// Settings that only exist in the Android app: automatic backup, app lock, home-screen widgets and
// the Wear OS watch. Each one is a sheet opened from the Settings tab, plus a one-line summary.
import { useEffect, useState } from "preact/hooks";
import { locale, t, tList } from "../../i18n/index.js";
import { Icon } from "../../ui/Icon.jsx";
import { toast } from "../../ui/Overlays.jsx";
import { Sheet } from "../../ui/Sheet.jsx";
import { Button, ListItem, Section, Segmented, Stepper, Toggle } from "../../ui/components.jsx";
import {
  backupNow,
  listWidgets,
  nativeSettings,
  openBackupFolder,
  pickBackupFolder,
  pinWidget,
  refreshWatch,
  sendToWatchNow,
  setLockEnabled,
  setNativeSettings,
  setWidgetConfig,
  useNative,
  watchInfo,
} from "./api.js";

const dateTime = (ms) =>
  new Date(ms).toLocaleString(locale(), {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Button that stays disabled for a moment after a tap (actions that run in the background). */
function OnceButton({ onClick, ...rest }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      {...rest}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        onClick();
        setTimeout(() => setBusy(false), 1500);
      }}
    />
  );
}

// ---------- Automatic backup ----------

export function backupSummary(backup = nativeSettings().backup) {
  if (!backup?.enabled) {
    return t("android.backup.off");
  }
  const weekday = tList("date.weekdays")[(backup.weekday || 1) - 1];
  return {
    change: t("android.backup.onChange"),
    daily: t("android.backup.onDaily", { time: backup.time }),
    weekly: t("android.backup.onWeekly", { day: weekday, time: backup.time }),
  }[backup.freq];
}

export function BackupSheet({ onClose }) {
  useNative();
  const backup = nativeSettings().backup || {};
  const set = (patch) => setNativeSettings({ backup: patch });
  const last = backup.last?.at ? backup.last : null;
  return (
    <Sheet
      onClose={onClose}
      tall={true}
      title={t("android.backup.title")}
      subtitle={t("android.backup.subtitle")}
      footer={
        <OnceButton kind="primary" block={true} icon="download" onClick={backupNow}>
          {t("android.backup.now")}
        </OnceButton>
      }
    >
      {last && (
        <div class={`callout ${last.ok ? "ok" : "danger"}`}>
          <Icon n={last.ok ? "check" : "alert"} size={18} />
          <div>
            <b>{t(last.ok ? "android.backup.last" : "android.backup.lastFailed")}</b>
            <p>
              {dateTime(last.at)}
              {last.msg ? ` · ${last.msg}` : ""}
            </p>
          </div>
        </div>
      )}
      <Toggle
        id="bk-on"
        checked={!!backup.enabled}
        onChange={(enabled) => set({ enabled })}
        label={t("android.backup.toggle")}
        hint={t("android.backup.toggleHint")}
      />
      {backup.enabled && (
        <>
          <div class="blk">
            <div class="cap">{t("android.backup.frequency")}</div>
            <Segmented
              value={backup.freq}
              onChange={(freq) => set({ freq })}
              options={[
                { v: "change", label: t("android.backup.freq.change") },
                { v: "daily", label: t("android.backup.freq.daily") },
                { v: "weekly", label: t("android.backup.freq.weekly") },
              ]}
            />
            {backup.freq === "change" && <p class="muted small">{t("android.backup.changeHint")}</p>}
          </div>
          {backup.freq !== "change" && (
            <div class="blk">
              <div class="cap">{t("android.backup.when")}</div>
              <div class="row gap-s">
                {backup.freq === "weekly" && (
                  <div class="sel grow">
                    <select
                      aria-label={t("android.backup.day")}
                      value={backup.weekday || 1}
                      onChange={(ev) => set({ weekday: Number(ev.currentTarget.value) })}
                    >
                      {tList("date.weekdays").map((day, i) => (
                        <option value={i + 1} key={day}>
                          {day}
                        </option>
                      ))}
                    </select>
                    <Icon n="chevD" size={16} />
                  </div>
                )}
                <input
                  class="inp"
                  type="time"
                  style="max-width:150px"
                  aria-label={t("android.backup.time")}
                  value={backup.time || "03:00"}
                  onChange={(ev) => ev.currentTarget.value && set({ time: ev.currentTarget.value })}
                />
              </div>
              <p class="muted small">{t("android.backup.timeHint")}</p>
            </div>
          )}
          <div class="blk">
            <div class="cap">{t("android.backup.location")}</div>
            <div class="stack">
              <Segmented
                value={backup.dest}
                onChange={(dest) =>
                  dest === "folder" && !backup.folderName ? pickBackupFolder() : set({ dest })
                }
                options={[
                  { v: "downloads", label: t("android.backup.downloads") },
                  { v: "folder", label: t("android.backup.folder") },
                ]}
              />
              <ListItem
                left={
                  <span class="li-ico">
                    <Icon n="folder" size={20} />
                  </span>
                }
                title={
                  backup.dest === "folder"
                    ? backup.folderName || t("android.backup.chooseFolder")
                    : t("android.backup.downloadsPath")
                }
                sub={t(backup.dest === "folder" ? "android.backup.folderHint" : "android.backup.downloadsHint")}
                onClick={() => (backup.dest === "folder" ? pickBackupFolder() : openBackupFolder())}
              />
            </div>
          </div>
          <div class="blk">
            <div class="cap">{t("android.backup.method")}</div>
            <Segmented
              value={backup.method}
              onChange={(method) => set({ method })}
              options={[
                { v: "history", label: t("android.backup.history"), sub: t("android.backup.historySub") },
                { v: "single", label: t("android.backup.single"), sub: t("android.backup.singleSub") },
              ]}
            />
          </div>
          {backup.method === "history" && (
            <div class="blk">
              <div class="cap">{t("android.backup.keep")}</div>
              <Stepper value={backup.keep || 10} onChange={(keep) => set({ keep })} min={1} max={60} />
              <p class="muted small">{t("android.backup.keepHint")}</p>
            </div>
          )}
          <div class="blk">
            <div class="cap">{t("android.backup.content")}</div>
            <Segmented
              value={backup.content}
              onChange={(content) => set({ content })}
              options={[
                { v: "full", label: t("android.backup.full"), sub: t("android.backup.fullSub") },
                { v: "config", label: t("android.backup.config"), sub: t("android.backup.configSub") },
              ]}
            />
          </div>
        </>
      )}
    </Sheet>
  );
}

// ---------- App lock ----------

export function lockSummary(lock = nativeSettings().lock) {
  if (!lock?.enabled) {
    return t("android.lock.off");
  }
  return lock.delay ? t("android.lock.onDelay", { n: lock.delay / 60 }) : t("android.lock.onNow");
}

export function LockSheet({ onClose }) {
  useNative();
  const lock = nativeSettings().lock || {};
  const set = (patch) => setNativeSettings({ lock: patch });
  return (
    <Sheet onClose={onClose} title={t("android.lock.title")} subtitle={t("android.lock.subtitle")}>
      {!lock.available ? (
        <div class="callout warn">
          <Icon n="alert" size={18} />
          <div>
            <b>{t("android.lock.unavailable")}</b>
            <p>{lock.availMsg || t("android.lock.unavailableHint")}</p>
          </div>
        </div>
      ) : (
        <>
          <Toggle
            id="lk-on"
            checked={!!lock.enabled}
            // The switch only moves once the native authentication succeeds.
            onChange={(on) => setLockEnabled(on)}
            label={t("android.lock.toggle")}
            hint={t("android.lock.toggleHint")}
          />
          {lock.enabled && (
            <>
              <div class="blk">
                <div class="cap">{t("android.lock.after")}</div>
                <Segmented
                  value={lock.delay}
                  onChange={(delay) => set({ delay })}
                  options={[
                    { v: 0, label: t("android.lock.now") },
                    { v: 60, label: t("android.lock.minutes", { n: 1 }) },
                    { v: 300, label: t("android.lock.minutes", { n: 5 }) },
                    { v: 900, label: t("android.lock.minutes", { n: 15 }) },
                  ]}
                />
                <p class="muted small">{t("android.lock.afterHint")}</p>
              </div>
              <Toggle
                id="lk-recents"
                checked={lock.hideRecents !== false}
                onChange={(hideRecents) => set({ hideRecents })}
                label={t("android.lock.recents")}
                hint={t("android.lock.recentsHint")}
              />
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

// ---------- Widgets ----------

const WIDGET_ICONS = { list: "list", calendar: "calendar", actions: "bolt" };

const widgetName = (kind) => t(`android.widget.${kind}`);

function widgetSummary(widget) {
  const cfg = widget.cfg || {};
  if (widget.kind === "list") {
    return t("android.widget.listSummary", { days: cfg.days, max: cfg.max, details: !!cfg.details });
  }
  if (widget.kind === "calendar") {
    return cfg.mode === "days" ? t("android.widget.nextDays", { n: cfg.days }) : t(`android.widget.mode.${cfg.mode}`);
  }
  return t("android.widget.actionsSummary");
}

export const widgetsSummary = () => t("android.widgets.count", { n: listWidgets().length });

export function WidgetsSheet({ onClose, onConfigure }) {
  useNative();
  const placed = listWidgets();
  return (
    <Sheet onClose={onClose} tall={true} title={t("android.widgets.title")} subtitle={t("android.widgets.subtitle")}>
      {placed.length > 0 && (
        <Section title={t("android.widgets.placed")}>
          <div class="stack">
            {placed.map((widget) => (
              <ListItem
                left={
                  <span class="li-ico">
                    <Icon n={WIDGET_ICONS[widget.kind] || "calendar"} size={20} />
                  </span>
                }
                title={widgetName(widget.kind)}
                sub={widgetSummary(widget)}
                onClick={() => onConfigure(widget.id)}
                key={widget.id}
              />
            ))}
          </div>
        </Section>
      )}
      <Section title={t("android.widgets.add")} hint={t("android.widgets.addHint")}>
        <div class="stack">
          {["list", "calendar", "actions"].map((kind) => (
            <ListItem
              left={
                <span class="li-ico">
                  <Icon n={WIDGET_ICONS[kind]} size={20} />
                </span>
              }
              title={widgetName(kind)}
              sub={t(`android.widget.${kind}Desc`)}
              right={<Icon n="plus" size={20} />}
              chevron={false}
              onClick={() => pinWidget(kind)}
              key={kind}
            />
          ))}
        </div>
      </Section>
    </Sheet>
  );
}

export function WidgetConfigSheet({ id, onClose }) {
  useNative();
  const widget = listWidgets().find((w) => w.id === id);
  useEffect(() => {
    if (!widget) {
      toast(t("android.widget.notFound"));
      onClose();
    }
  }, []);
  if (!widget) {
    return null;
  }
  const cfg = widget.cfg || {};
  const set = (patch) => setWidgetConfig(id, patch);
  return (
    <Sheet onClose={onClose} title={widgetName(widget.kind)} subtitle={t("android.widget.settings")}>
      {widget.kind === "list" && (
        <>
          <div class="blk">
            <div class="cap">{t("android.widget.period")}</div>
            <Segmented
              value={cfg.days}
              onChange={(days) => set({ days, offset: 0 })}
              options={[3, 7, 14, 30, 60].map((v) => ({ v, label: t("android.widget.days", { n: v }) }))}
            />
          </div>
          <div class="blk">
            <div class="cap">{t("android.widget.max")}</div>
            <Stepper value={cfg.max} onChange={(max) => set({ max })} min={1} max={40} />
          </div>
          <Toggle
            id="wg-details"
            checked={!!cfg.details}
            onChange={(details) => set({ details })}
            label={t("android.widget.details")}
            hint={t("android.widget.detailsHint")}
          />
          <Toggle
            id="wg-group"
            checked={cfg.group !== false}
            onChange={(group) => set({ group })}
            label={t("android.widget.group")}
            hint={t("android.widget.groupHint")}
          />
        </>
      )}
      {widget.kind === "calendar" && (
        <>
          <div class="blk">
            <div class="cap">{t("android.widget.display")}</div>
            <Segmented
              value={cfg.mode}
              onChange={(mode) => set({ mode, offset: 0 })}
              options={["week", "month", "days"].map((v) => ({ v, label: t(`android.widget.mode.${v}`) }))}
            />
          </div>
          {cfg.mode === "days" && (
            <div class="blk">
              <div class="cap">{t("android.widget.dayCount")}</div>
              <Stepper
                value={cfg.days}
                onChange={(days) => set({ days })}
                min={2}
                max={14}
                format={(n) => t("android.widget.days", { n })}
              />
            </div>
          )}
          {cfg.mode === "month" && (
            <Toggle
              id="wg-rolling"
              checked={!!cfg.rolling}
              onChange={(rolling) => set({ rolling, offset: 0 })}
              label={t("android.widget.rolling")}
              hint={t("android.widget.rollingHint")}
            />
          )}
          <Toggle
            id="wg-labels"
            checked={cfg.labels !== false}
            onChange={(labels) => set({ labels })}
            label={t("android.widget.labels")}
            hint={t("android.widget.labelsHint")}
          />
        </>
      )}
      {widget.kind === "actions" && <p class="muted">{t("android.widget.actionsHint")}</p>}
    </Sheet>
  );
}

// ---------- Watch ----------

export function watchSummary(info = watchInfo()) {
  if (!info?.nodes?.length) {
    return t("android.watch.none");
  }
  return info.at
    ? t("android.watch.summary", { names: info.nodes.join(", "), at: dateTime(info.at) })
    : info.nodes.join(", ");
}

export function WatchSheet({ onClose }) {
  useNative();
  useEffect(() => {
    refreshWatch();
  }, []);
  const info = watchInfo();
  const connected = !!info.nodes?.length;
  return (
    <Sheet
      onClose={onClose}
      title={t("android.watch.title")}
      subtitle={t("android.watch.subtitle")}
      footer={
        <OnceButton kind="primary" block={true} icon="repeat" onClick={sendToWatchNow}>
          {t("android.watch.sendNow")}
        </OnceButton>
      }
    >
      <div class={`callout ${connected ? "ok" : "warn"}`}>
        <Icon n={connected ? "check" : "alert"} size={18} />
        <div>
          <b>{connected ? info.nodes.join(", ") : t("android.watch.none")}</b>
          <p>{info.at ? t("android.watch.lastSent", { at: dateTime(info.at) }) : t("android.watch.neverSent")}</p>
        </div>
      </div>
      <p class="muted small">{t("android.watch.howItWorks")}</p>
      <p class="muted small">{t("android.watch.setup")}</p>
    </Sheet>
  );
}
