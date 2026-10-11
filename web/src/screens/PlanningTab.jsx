// Schedule tab: events listed by month and day, search, filters, and multiple selection (export,
// duplicate, mark as exported, delete).
import { useState, useMemo } from "preact/hooks";
import { t } from "../i18n/index.js";
import { addDays, formatDateShort, monthName, parseIso, todayIso } from "../lib/dates.js";
import { addEvents, copyEvents, deleteEvents, markExported, markNotExported } from "../lib/events.js";
import { haptic } from "../lib/haptics.js";
import { useIntent } from "../lib/intents.js";
import { getState, loadPref, savePref, undo, updateState, useAppState } from "../lib/store.js";
import { eventDescription, eventTitle } from "../lib/templates.js";
import { checkEvents, sortEvents } from "../lib/timing.js";
import { EventCard } from "./EventCard.jsx";
import { EditEventFlow } from "./EventFlows.jsx";
import { ExportSheet } from "./ExportSheet.jsx";
import { Icon } from "../ui/Icon.jsx";
import { confirmDialog, toast } from "../ui/Overlays.jsx";
import { Sheet } from "../ui/Sheet.jsx";
import { Button, EmptyState, Segmented, Stepper } from "../ui/components.jsx";

function DuplicateSheet({ events, onClose, onDone }) {
  const [offset, setOffset] = useState(7);
  const presets = [7, 14, 28].map((v) => ({ v, label: t("plan.dup.weeks", { n: v / 7 }) }));
  const firstDate = events.map((ev) => ev.date).sort()[0];
  return (
    <Sheet
      onClose={onClose}
      title={t("plan.duplicate")}
      subtitle={t("common.events", { n: events.length })}
      footer={
        <Button
          kind="primary"
          block={true}
          icon="copy"
          onClick={() => {
            const copies = copyEvents(events, offset);
            updateState((prev) => addEvents(prev, copies), { label: t("undo.duplicate") });
            toast(t("plan.dup.done", { n: copies.length }), { action: { label: t("common.undo"), run: undo } });
            onDone();
          }}
        >
          {t("plan.duplicate")}
        </Button>
      }
    >
      <div class="blk">
        <div class="cap">{t("plan.dup.offset")}</div>
        <Segmented
          value={presets.some((p) => p.v === offset) ? offset : null}
          onChange={setOffset}
          options={presets}
        />
      </div>
      <div class="blk">
        <div class="cap">{t("plan.dup.exact")}</div>
        <Stepper
          value={offset}
          onChange={setOffset}
          min={-365}
          max={365}
          format={(n) => t("summary.daysShort", { n })}
        />
      </div>
      <p class="muted small">
        {t("plan.dup.preview", {
          from: formatDateShort(firstDate),
          to: formatDateShort(addDays(firstDate, offset)),
        })}
      </p>
    </Sheet>
  );
}

export function PlanningTab() {
  const state = useAppState();
  const [filter, setFilterState] = useState(() => loadPref("planFilter", "new"));
  const [hidePast, setHidePastState] = useState(() => loadPref("planHidePast", false));
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [editingId, setEditingId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [query, setQuery] = useState("");
  const [duplicating, setDuplicating] = useState(null);
  const [autoSend, setAutoSend] = useState(false);
  const today = todayIso();
  const setFilter = (value) => {
    setFilterState(value);
    savePref("planFilter", value);
  };
  const setHidePast = (value) => {
    setHidePastState(value);
    savePref("planHidePast", value);
  };
  const issues = useMemo(() => checkEvents(state), [state.events, state.types, state.slots, state.fields]);
  const sorted = sortEvents(state, state.events);
  const pending = sorted.filter((ev) => ev.status !== "exported");
  const needle = query.trim().toLowerCase();
  const matches = (ev) =>
    !needle || `${eventTitle(state, ev)} ${eventDescription(state, ev)}`.toLowerCase().includes(needle);
  const shown = sorted
    .filter(matches)
    .filter((ev) =>
      filter === "new"
        ? ev.status !== "exported"
        : filter === "issues"
          ? issues[ev.id]?.length || Object.keys(ev.review || {}).length
          : true,
    )
    .filter((ev) => !hidePast || ev.date >= today);
  const months = [];
  for (const ev of shown) {
    const monthKey = ev.date.slice(0, 7);
    let month = months[months.length - 1];
    if (!month || month.key !== monthKey) {
      months.push((month = { key: monthKey, days: [] }));
    }
    let day = month.days[month.days.length - 1];
    if (!day || day.date !== ev.date) {
      month.days.push((day = { date: ev.date, evs: [] }));
    }
    day.evs.push(ev);
  }
  const toggle = (id) => {
    haptic(6);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };
  const endSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const selectedEvents = state.events.filter((ev) => selected.has(ev.id));
  const toExport = selected.size ? selectedEvents : pending;
  // Shortcuts and widgets: open the export sheet, optionally sending right away.
  useIntent(["plan", "export", "sync"], (name) => {
    if (name === "plan") {
      return;
    }
    endSelection();
    if (!getState().events.some((ev) => ev.status !== "exported")) {
      toast(t("plan.allExported"));
      return;
    }
    setAutoSend(name === "sync");
    setExporting(true);
  });
  const deleteSelected = async () => {
    if (
      await confirmDialog({
        title: t("plan.deleteTitle", { n: selected.size }),
        text: t("common.undoHint"),
        confirmLabel: t("common.delete"),
        danger: true,
      })
    ) {
      updateState((prev) => deleteEvents(prev, [...selected]), { label: t("undo.delete") });
      toast(t("plan.deleted"), { action: { label: t("common.undo"), run: undo } });
      endSelection();
    }
  };
  return (
    <div class="page">
      <header class="top">
        <div class="top-t">
          <h1>{t("plan.title")}</h1>
        </div>
        <div class="row gap-s">
          {selecting ? (
            <Button kind="soft" small={true} onClick={endSelection}>
              {t("plan.done")}
            </Button>
          ) : (
            <Button
              kind="soft"
              small={true}
              icon="check"
              onClick={() => setSelecting(true)}
              disabled={!state.events.length}
            >
              {t("plan.select")}
            </Button>
          )}
        </div>
      </header>
      <div class="scroll">
        <div class="search">
          <Icon n="search" size={18} />
          <input
            id="plan-q"
            type="search"
            placeholder={t("plan.search")}
            value={query}
            onInput={(ev) => setQuery(ev.currentTarget.value)}
            autocomplete="off"
            aria-label={t("plan.searchLabel")}
          />
          {query && (
            <button type="button" class="ibtn sm" aria-label={t("common.clear")} onClick={() => setQuery("")}>
              <Icon n="x" size={16} />
            </button>
          )}
        </div>
        <div class="modebar">
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { v: "new", label: t("plan.filter.new"), sub: String(pending.length) },
              { v: "all", label: t("plan.filter.all"), sub: String(sorted.length) },
              { v: "issues", label: t("plan.filter.issues") },
            ]}
          />
          <button
            type="button"
            class={`chip sm ${hidePast ? "on" : ""}`}
            onClick={() => setHidePast(!hidePast)}
            aria-pressed={hidePast}
          >
            {t("plan.hidePast")}
          </button>
        </div>
        {shown.length === 0 && (
          <EmptyState
            icon={state.events.length ? "check" : "calendar"}
            title={
              state.events.length
                ? t(filter === "new" ? "plan.allExported" : "plan.noResult")
                : t("plan.noEvents")
            }
            text={t(state.events.length ? "plan.changeFilter" : "plan.addFromCalendar")}
          />
        )}
        {months.map((month) => {
          const { y: year, m: monthNum } = parseIso(month.key + "-01");
          const ids = month.days.flatMap((day) => day.evs.map((ev) => ev.id));
          return (
            <section class="plan-m" key={month.key}>
              <header class="plan-mh">
                <h2>
                  {monthName(monthNum)} {year}
                </h2>
                {selecting && (
                  <button
                    type="button"
                    class="link"
                    onClick={() => setSelected((prev) => new Set([...prev, ...ids]))}
                  >
                    {t("plan.wholeMonth")}
                  </button>
                )}
              </header>
              {month.days.map((day) => (
                <div class="plan-d" key={day.date}>
                  <div class={`plan-dh ${day.date === today ? "today" : ""}`}>
                    {formatDateShort(day.date)}
                  </div>
                  <div class="stack">
                    {day.evs.map((ev) => (
                      <div class="sel-row" key={ev.id}>
                        {selecting && (
                          <button
                            type="button"
                            class={`cbx ${selected.has(ev.id) ? "on" : ""}`}
                            onClick={() => toggle(ev.id)}
                            aria-pressed={selected.has(ev.id)}
                            aria-label={t("plan.select")}
                          >
                            {selected.has(ev.id) && <Icon n="check" size={15} sw={3} />}
                          </button>
                        )}
                        <EventCard
                          state={state}
                          event={ev}
                          issue={issues[ev.id]}
                          onClick={() => (selecting ? toggle(ev.id) : setEditingId(ev.id))}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </div>
      <div class="actionbar">
        {selecting && selected.size > 0 ? (
          <div class="row gap-s wrap">
            <Button kind="danger" icon="trash" onClick={deleteSelected} aria-label={t("common.delete")} />
            <Button kind="soft" icon="copy" onClick={() => setDuplicating(selectedEvents)}>
              {t("plan.duplicate")}
            </Button>
            <Button
              kind="soft"
              onClick={() => {
                updateState(
                  (prev) =>
                    selectedEvents.every((ev) => ev.status === "exported")
                      ? markNotExported(prev, [...selected])
                      : markExported(prev, [...selected]),
                  { label: t("undo.status") },
                );
                endSelection();
              }}
            >
              {t(selectedEvents.every((ev) => ev.status === "exported") ? "plan.markNew" : "plan.markExported")}
            </Button>
            <Button kind="primary" block={true} icon="download" onClick={() => setExporting(true)}>
              {t("plan.exportCount", { n: selected.size })}
            </Button>
          </div>
        ) : (
          <Button
            kind="primary"
            block={true}
            icon="download"
            disabled={!toExport.length}
            onClick={() => setExporting(true)}
          >
            {toExport.length ? t("plan.exportEvents", { n: toExport.length }) : t("plan.nothingToExport")}
          </Button>
        )}
      </div>
      {editingId && <EditEventFlow eventId={editingId} onDone={() => setEditingId(null)} />}
      {duplicating && (
        <DuplicateSheet
          events={duplicating}
          onClose={() => setDuplicating(null)}
          onDone={() => {
            setDuplicating(null);
            endSelection();
          }}
        />
      )}
      {exporting && (
        <ExportSheet
          events={toExport}
          scope={selected.size ? "selection" : "pending"}
          autoSend={autoSend}
          onClose={() => {
            setExporting(false);
            setAutoSend(false);
          }}
          onExported={endSelection}
        />
      )}
    </div>
  );
}
