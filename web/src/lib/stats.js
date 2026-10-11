// Hours summary: worked hours per month and per person, following adjustable counting rules
// (Settings › Hours summary). The rules live in the state (`state.stats`), so they are backed up,
// restored and transferred with everything else:
//
//   stats = {
//     types:   { [typeId]: { cat: 'service' | 'off' | 'ignore', dur: null | minutes, pause: minutes, people: bool } },
//     fields:  { [fieldId]: { people: bool } },
//     exclude: [names left out of the per-person summary],
//   }
//
// Without rules, timed events count their slot hours and all-day events count as days off.
import { addDays, daysBetween, timeToMinutes } from "./dates.js";
import { compareText, t } from "../i18n/index.js";
import { fieldValue, findField, findType, isPeopleField } from "./model.js";
import { eventTiming } from "./timing.js";

export const typeDefaults = (type) => ({
  cat: type.kind === "allday" ? "off" : "service",
  dur: null,
  pause: 0,
  people: true,
});

/** Effective rule for an event type (saved settings over defaults). */
export function typeRule(state, type) {
  const rule = { ...typeDefaults(type), ...(state?.stats?.types?.[type.id] || {}) };
  if (rule.cat === "ignore") rule.people = false;
  return rule;
}

/** Do names entered in this field count in the per-person summary? */
export const fieldCounts = (state, field) => state?.stats?.fields?.[field.id]?.people !== false;

const excludedNames = (state) =>
  new Set((state?.stats?.exclude || []).map((n) => String(n).trim().toLowerCase()));

/** Actual length of a timed event, from its slot times. */
const slotMinutes = (timing) =>
  daysBetween(timing.startDate, timing.endDate) * 1440 +
  timeToMinutes(timing.endTime) -
  timeToMinutes(timing.startTime);

/** Worked minutes counted for an event (`days` days for an all-day event). */
export function serviceMinutes(rule, timing, days = 1) {
  if (rule.cat !== "service" || !timing) return 0;
  if (timing.allDay) return (rule.dur || 0) * days;
  if (rule.dur != null) return rule.dur;
  return Math.max(0, slotMinutes(timing) - (rule.pause || 0));
}

/**
 * Totals for the period [from, to): worked minutes, nights, days off, and a count per type
 * (chips of the monthly summary). `unit` is "days" for all-day types.
 */
export function periodTotals(state, from, to) {
  const byType = new Map();
  let minutes = 0;
  let nights = 0;
  let daysOff = 0;
  for (const ev of state.events || []) {
    const type = findType(state, ev.typeId);
    const timing = type && eventTiming(state, ev);
    if (!type || !timing) continue;
    const rule = typeRule(state, type);
    if (rule.cat === "ignore") continue;
    if (timing.allDay) {
      let count = 0;
      for (let day = timing.startDate; day < timing.endDate; day = addDays(day, 1)) {
        if (day >= from && day < to) count++;
      }
      if (!count) continue;
      if (rule.cat === "off") daysOff += count;
      else minutes += serviceMinutes(rule, timing, count);
      const entry = byType.get(type.id) || { t: type, n: 0, unit: "days" };
      entry.n += count;
      byType.set(type.id, entry);
    } else {
      if (ev.date < from || ev.date >= to) continue;
      const entry = byType.get(type.id) || { t: type, n: 0, unit: "" };
      entry.n += 1;
      byType.set(type.id, entry);
      if (rule.cat === "off") {
        daysOff += 1;
        continue;
      }
      minutes += serviceMinutes(rule, timing);
      if (timing.nextDay) nights += 1;
    }
  }
  return { minutes, nights, daysOff, byType };
}

/**
 * Per-person summary over [from, to): for each name, number of events and worked hours, broken
 * down by type and by role (field).
 */
export function peopleStats(state, { from = null, to = null } = {}) {
  const byName = new Map();
  const excluded = excludedNames(state);
  const bump = (map, key, init) => {
    const entry = map.get(key) || { ...init, n: 0, min: 0 };
    map.set(key, entry);
    return entry;
  };
  for (const ev of state.events) {
    if ((from && ev.date < from) || (to && ev.date >= to)) continue;
    const type = findType(state, ev.typeId);
    if (!type) continue;
    const rule = typeRule(state, type);
    if (!rule.people) continue;
    const timing = eventTiming(state, ev);
    const minutes = serviceMinutes(rule, timing, timing?.allDay ? timing.days || 1 : 1);
    // Someone listed in two fields of the same event counts once.
    const counted = new Set();
    for (const field of state.fields) {
      if (!isPeopleField(field) || !fieldCounts(state, field)) continue;
      for (const raw of fieldValue(ev, field.id, field)) {
        const name = String(raw).trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (excluded.has(key)) continue;
        const person = byName.get(key) || { name, n: 0, min: 0, types: new Map(), roles: new Map() };
        byName.set(key, person);
        if (!counted.has(key)) {
          counted.add(key);
          person.n++;
          person.min += minutes;
          const byType = bump(person.types, type.id, { id: type.id, label: type.name, color: type.color });
          byType.n++;
          byType.min += minutes;
        }
        const role = bump(person.roles, field.id, {
          id: field.id,
          label: findField(state, field.id)?.label || field.label,
        });
        role.n++;
        role.min += minutes;
      }
    }
  }
  return [...byName.values()]
    .map((person) => ({
      ...person,
      types: [...person.types.values()].sort((a, b) => b.min - a.min || b.n - a.n),
      roles: [...person.roles.values()].sort((a, b) => b.n - a.n),
    }))
    .sort((a, b) => b.min - a.min || b.n - a.n || compareText(a.name, b.name));
}

/** "280h 30m" / "280 h 30", "7h" / "7 h". */
export const formatHours = (minutes) => {
  const total = minutes || 0;
  return t("hours.format", { h: Math.floor(total / 60), m: String(total % 60).padStart(2, "0") });
};

/** "152h 30m worked · 4 nights · 6 days off" */
export function totalsLine(totals) {
  const parts = [t("summary.worked", { hours: formatHours(totals.minutes) })];
  if (totals.nights) parts.push(t("summary.nights", { n: totals.nights }));
  if (totals.daysOff) parts.push(t("summary.daysOff", { n: totals.daysOff }));
  return parts.join(" · ");
}
