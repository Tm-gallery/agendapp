// Actual event times, consistency checks (duplicates, overlaps, required fields) and sorting.
import { addDays, daysBetween, formatTime, timeToMinutes } from "./dates.js";
import { t } from "../i18n/index.js";
import { fieldValue, findType, isEmptyValue, slotTimes, typeFields } from "./model.js";
import { eventKey } from "./rules.js";
import { eventTitle } from "./templates.js";

/**
 * Start and end of an event: { allDay, startDate, endDate (exclusive for all-day events),
 * startTime, endTime, nextDay }. null if its type or slot no longer exists.
 */
export function eventTiming(state, ev) {
  const type = findType(state, ev.typeId);
  if (!type) {
    return null;
  }
  if (type.kind === "allday") {
    const days = Math.max(1, ev.days || type.days || 1);
    return {
      allDay: true,
      startDate: ev.date,
      endDate: addDays(ev.date, days),
      days,
    };
  }
  const times = slotTimes(state, type, ev.slotId);
  return times
    ? {
        allDay: false,
        startDate: ev.date,
        startTime: times.start,
        endDate: times.nextDay ? addDays(ev.date, 1) : ev.date,
        endTime: times.end,
        nextDay: times.nextDay,
      }
    : null;
}

// Arbitrary origin to compare instants in minutes.
const EPOCH = "2000-01-01";

function timingMinutes(timing) {
  return timing.allDay
    ? [daysBetween(EPOCH, timing.startDate) * 1440, daysBetween(EPOCH, timing.endDate) * 1440]
    : [
        daysBetween(EPOCH, timing.startDate) * 1440 + timeToMinutes(timing.startTime),
        daysBetween(EPOCH, timing.endDate) * 1440 + timeToMinutes(timing.endTime),
      ];
}

/**
 * Warnings per event: { [id]: [{ level: "error" | "warn", text }] }: deleted type, missing slot,
 * empty required field, duplicate, overlapping times, or an event during an all-day event.
 */
export function checkEvents(state, events = state.events) {
  const issues = {};
  const flag = (id, level, text) => {
    (issues[id] ||= []).push({ level, text });
  };
  const timings = new Map();
  for (const ev of events) {
    timings.set(ev.id, eventTiming(state, ev));
  }
  const byKey = new Map();
  for (const ev of events) {
    if (!findType(state, ev.typeId)) {
      flag(ev.id, "error", t("issue.typeDeleted"));
      continue;
    }
    if (!timings.get(ev.id)) {
      flag(ev.id, "error", t("issue.slotMissing"));
    }
    const key = eventKey(ev);
    byKey.set(key, [...(byKey.get(key) || []), ev]);
    for (const { field, required } of typeFields(state, ev.typeId, ev.slotId)) {
      if (required && isEmptyValue(fieldValue(ev, field.id, field))) {
        flag(ev.id, "warn", t("issue.missing", { label: field.label }));
      }
    }
  }
  for (const group of byKey.values()) {
    if (group.length > 1) {
      for (const ev of group) {
        flag(ev.id, "warn", t("issue.duplicate"));
      }
    }
  }
  const timed = events.filter((ev) => timings.get(ev.id));
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i];
      const b = timed[j];
      if (eventKey(a) === eventKey(b)) {
        continue;
      }
      const [aStart, aEnd] = timingMinutes(timings.get(a.id));
      const [bStart, bEnd] = timingMinutes(timings.get(b.id));
      const ta = timings.get(a.id);
      const tb = timings.get(b.id);
      if (ta.allDay && tb.allDay) {
        if (aStart < bEnd && bStart < aEnd) {
          flag(a.id, "warn", t("issue.overlaps", { title: eventTitle(state, b) }));
          flag(b.id, "warn", t("issue.overlaps", { title: eventTitle(state, a) }));
        }
      } else if (ta.allDay !== tb.allDay) {
        const [whole, other, wholeTiming, otherTiming] = ta.allDay ? [a, b, ta, tb] : [b, a, tb, ta];
        if (otherTiming.startDate >= wholeTiming.startDate && otherTiming.startDate < wholeTiming.endDate) {
          flag(other.id, "warn", t("issue.during", { title: eventTitle(state, whole) }));
          flag(whole.id, "warn", t("issue.sameDay", { title: eventTitle(state, other) }));
        }
      } else if (aStart < bEnd && bStart < aEnd) {
        flag(a.id, "warn", t("issue.overlaps", { title: eventTitle(state, b) }));
        flag(b.id, "warn", t("issue.overlaps", { title: eventTitle(state, a) }));
      }
    }
  }
  return issues;
}

/** Sorts by date, then all-day events first, then start time, then creation order. */
export const sortEvents = (state, events) =>
  [...events].sort((ev, other) => {
    if (ev.date !== other.date) {
      return ev.date < other.date ? -1 : 1;
    }
    const ta = eventTiming(state, ev);
    const tb = eventTiming(state, other);
    const ka = ta ? (ta.allDay ? -1 : timeToMinutes(ta.startTime)) : 9999;
    const kb = tb ? (tb.allDay ? -1 : timeToMinutes(tb.startTime)) : 9999;
    return ka - kb || (ev.createdAt || 0) - (other.createdAt || 0);
  });

/** Events occupying this day (all-day events included), sorted. */
export function eventsOnDay(state, events, day) {
  return sortEvents(
    state,
    events.filter((ev) => {
      const timing = eventTiming(state, ev);
      return timing && timing.allDay ? day >= timing.startDate && day < timing.endDate : ev.date === day;
    }),
  );
}

/** "8:00 → 12:00", "19:00 → 7:30 (+1 d)" */
export function slotLabel(state, type, slotId) {
  const times = slotTimes(state, type, slotId);
  return times
    ? `${formatTime(times.start)} → ${formatTime(times.end)}${times.nextDay ? t("time.nextDay") : ""}`
    : "";
}
