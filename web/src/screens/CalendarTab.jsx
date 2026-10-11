// Calendar tab: month grid, selection of one day, several days or a range, the chosen day's
// events, the monthly summary and the add button. Shows a first-run checklist while empty.
import { useState, useRef, useMemo } from "preact/hooks";
import { t } from "../i18n/index.js";
import {
  addMonths,
  dateRange,
  formatDateLong,
  formatDateShort,
  monthGrid,
  monthName,
  parseIso,
  todayIso,
  weekdayLetters,
} from "../lib/dates.js";
import { exampleState } from "../lib/example.js";
import { haptic } from "../lib/haptics.js";
import { useIntent } from "../lib/intents.js";
import { colorById, findType, setupProgress } from "../lib/model.js";
import {
  canUndo,
  getState,
  importState,
  isTemplateHidden,
  loadPref,
  savePref,
  undo,
  useAppState,
} from "../lib/store.js";
import { eventCode } from "../lib/templates.js";
import { checkEvents, eventsOnDay } from "../lib/timing.js";
import { EventCard } from "./EventCard.jsx";
import { AddEventFlow, EditEventFlow } from "./EventFlows.jsx";
import { MonthSummary } from "./MonthSummary.jsx";
import { Icon } from "../ui/Icon.jsx";
import { toast } from "../ui/Overlays.jsx";
import { Button, IconButton, Segmented, contrastText } from "../ui/components.jsx";

function Onboarding({ state, goSettings }) {
  const progress = setupProgress(state);
  return (
    <div class="onb">
      <h2>{t("onboarding.title")}</h2>
      <p>{t("onboarding.text")}</p>
      <ol class="onb-steps">
        {["slots", "fields", "types", "rules"].map((key) => (
          <li class={progress[key] ? "done" : ""} key={key}>
            <i>{progress[key] ? <Icon n="check" size={14} sw={3} /> : null}</i>
            <span>
              <b>{t(`onboarding.${key}`)}</b>
              <small>{t(`onboarding.${key}Hint`)}</small>
            </span>
          </li>
        ))}
      </ol>
      <div class="stack">
        {!isTemplateHidden() && (
          <Button
            kind="primary"
            block={true}
            icon="wand"
            onClick={() => {
              importState(exampleState(), { label: t("undo.template") });
              toast(t("onboarding.templateLoaded"));
            }}
          >
            {t("onboarding.loadTemplate")}
          </Button>
        )}
        <Button kind="soft" block={true} icon="gear" onClick={goSettings}>
          {t("onboarding.configure")}
        </Button>
      </div>
    </div>
  );
}

export function CalendarTab({ goSettings }) {
  const state = useAppState();
  const today = todayIso();
  const todayParts = parseIso(today);
  const [ym, setYm] = useState({ y: todayParts.y, m: todayParts.m });
  const [selMode, setSelModeState] = useState(() => loadPref("selMode", "one"));
  const [selected, setSelected] = useState([today]);
  const [rangeStart, setRangeStart] = useState(null);
  const [focus, setFocus] = useState(today);
  const [adding, setAdding] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const swipeRef = useRef(null);
  const dayRef = useRef(null);
  const setSelMode = (mode) => {
    setSelModeState(mode);
    savePref("selMode", mode);
    setRangeStart(null);
    if (mode === "one") {
      setSelected((prev) => (prev.length ? [prev[prev.length - 1]] : [today]));
    }
  };
  const weeks = useMemo(() => monthGrid(ym.y, ym.m), [ym]);
  const issues = useMemo(() => checkEvents(state), [state.events, state.types, state.slots, state.fields]);
  const shiftMonth = (delta) => {
    haptic(6);
    setYm((prev) => addMonths(prev.y, prev.m, delta));
  };
  /** Shows `day` in the grid and selects it alone. */
  const showDay = (day) => {
    const parts = parseIso(day);
    setYm({ y: parts.y, m: parts.m });
    setFocus(day);
    setSelected([day]);
    setRangeStart(null);
  };
  const goToday = () => {
    haptic();
    showDay(today);
  };
  const tapDay = (day) => {
    haptic(6);
    setFocus(day);
    if (selMode === "one") {
      setSelected([day]);
    } else if (selMode === "multi") {
      setSelected((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
    } else if (rangeStart) {
      setSelected(dateRange(rangeStart, day));
      setRangeStart(null);
    } else {
      setRangeStart(day);
      setSelected([day]);
    }
    const parts = parseIso(day);
    if (parts.m !== ym.m) {
      setYm({ y: parts.y, m: parts.m });
    }
  };
  useIntent(["new", "day"], (name, arg) => {
    if (name === "day" && /^\d{4}-\d{2}-\d{2}$/.test(arg)) {
      showDay(arg);
      setTimeout(() => dayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    } else if (name === "new") {
      showDay(today);
      if (getState().types.length) {
        setAdding({ dates: [today] });
      } else {
        toast(t("cal.needType"));
      }
    }
  });
  const onSwipeStart = (ev) => {
    swipeRef.current = { x: ev.clientX, y: ev.clientY };
  };
  const onSwipeEnd = (ev) => {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start) {
      return;
    }
    const dx = ev.clientX - start.x;
    const dy = ev.clientY - start.y;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 45) {
      shiftMonth(dx < 0 ? 1 : -1);
    }
  };
  const dayEvents = eventsOnDay(state, state.events, focus);
  const selectedSet = new Set(selected);
  const canAdd = selected.length > 0 && state.types.length > 0;
  return (
    <div class="page">
      <header class="top">
        <div class="top-t">
          <h1>
            {monthName(ym.m)} <span>{ym.y}</span>
          </h1>
        </div>
        <div class="row gap-s">
          <IconButton n="chevL" label={t("cal.prevMonth")} onClick={() => shiftMonth(-1)} />
          <Button kind="soft" small={true} onClick={goToday}>
            {t("cal.today")}
          </Button>
          <IconButton n="chevR" label={t("cal.nextMonth")} onClick={() => shiftMonth(1)} />
        </div>
      </header>
      <div class="scroll">
        {state.types.length === 0 && <Onboarding state={state} goSettings={goSettings} />}
        <div class="modebar">
          <Segmented
            value={selMode}
            onChange={setSelMode}
            options={[
              { v: "one", label: t("cal.mode.one") },
              { v: "multi", label: t("cal.mode.multi") },
              { v: "range", label: t("cal.mode.range") },
            ]}
          />
          {canUndo() && (
            <IconButton
              n="undo"
              label={t("cal.undo")}
              onClick={() => {
                const label = undo();
                toast(label ? t("undo.doneWith", { label }) : t("undo.done"));
              }}
            />
          )}
          {selMode !== "one" && (
            <span class="muted small modehint">
              {selMode === "multi" && t("cal.hint.multi")}
              {selMode === "range" && t(rangeStart ? "cal.hint.rangeEnd" : "cal.hint.rangeStart")}
            </span>
          )}
        </div>
        <div
          class="cal"
          onPointerDown={onSwipeStart}
          onPointerUp={onSwipeEnd}
          onPointerCancel={() => (swipeRef.current = null)}
        >
          <div class="cal-dow">
            {weekdayLetters().map((letter, i) => (
              <span class={i > 4 ? "we" : ""} key={i}>
                {letter}
              </span>
            ))}
          </div>
          {weeks.map((week) => (
            <div class="cal-week" key={week[0]}>
              {week.map((day) => {
                const parts = parseIso(day);
                const events = eventsOnDay(state, state.events, day);
                const isSelected = selectedSet.has(day);
                const hasIssue = events.some((ev) => issues[ev.id]?.length);
                return (
                  <button
                    type="button"
                    class={`cell ${parts.m !== ym.m ? "out" : ""} ${day === today ? "today" : ""} ${isSelected ? "sel" : ""} ${day === focus ? "focus" : ""}`}
                    onClick={() => tapDay(day)}
                    aria-label={formatDateLong(day)}
                    aria-pressed={isSelected}
                    key={day}
                  >
                    <span class="cell-n">
                      {parts.d}
                      {hasIssue && <i class="warn-dot" />}
                    </span>
                    <span class="cell-pills">
                      {events.slice(0, 3).map((ev) => {
                        const type = findType(state, ev.typeId);
                        const color = colorById(type?.color).hex;
                        return (
                          <i
                            class={`pill ${type?.kind === "allday" ? "allday" : ""} ${ev.status === "exported" ? "done" : ""}`}
                            style={{ "--c": color, "--ct": contrastText(color) }}
                            key={ev.id}
                          >
                            {eventCode(state, ev)}
                          </i>
                        );
                      })}
                      {events.length > 3 && <em class="more">+{events.length - 3}</em>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <section class="dayp" ref={dayRef}>
          <header>
            <h2>{formatDateLong(focus)}</h2>
            <span class="muted small">
              {dayEvents.length ? t("common.events", { n: dayEvents.length }) : t("cal.nothing")}
            </span>
          </header>
          <div class="stack">
            {dayEvents.map((ev) => (
              <EventCard
                state={state}
                event={ev}
                issue={issues[ev.id]}
                onClick={() => setEditingId(ev.id)}
                key={ev.id}
              />
            ))}
          </div>
        </section>
        <MonthSummary state={state} ym={ym} />
      </div>
      <div class="actionbar">
        {canAdd ? (
          <Button
            kind="primary"
            block={true}
            icon="plus"
            onClick={() => {
              haptic(10);
              setAdding({ dates: [...selected].sort() });
            }}
          >
            {selected.length === 1
              ? t("cal.addOn", { day: parseIso(selected[0]).d, date: formatDateShort(selected[0]) })
              : t("cal.addOnDays", { n: selected.length })}
          </Button>
        ) : (
          <Button kind="soft" block={true} disabled={true}>
            {state.types.length ? t("cal.pickDay") : t("cal.needType")}
          </Button>
        )}
      </div>
      {adding && (
        <AddEventFlow
          dates={adding.dates}
          onDone={(value) => {
            setAdding(null);
            if (value && selMode !== "one") {
              setSelected([]);
              setRangeStart(null);
            }
          }}
        />
      )}
      {editingId && <EditEventFlow eventId={editingId} onDone={() => setEditingId(null)} />}
    </div>
  );
}
