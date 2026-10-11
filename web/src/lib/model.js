// Data model. The whole app state is one JSON object, saved and backed up as is:
//
//   settings  preferences (calendar name, time zone, language, theme, export options…)
//   groups    slot groups          { id, name }                        e.g. Day, Night
//   slots     time slots           { id, name, code, start, end, groupId }
//   fields    fields to fill in    { id, key, label, kind, sticky }     kind: person | people | text | time
//   types     event types          { id, name, code, color, kind, slotIds, fields, titleTpl, descTpl,
//                                    location, alarms, days, snapWeek, times }   kind: slot | allday
//   rules     automation rules     { id, kind, enabled, name, when, then }      kind: propose | prefill
//   events    events               { id, date, typeId, slotId, days, values, review, note, status, … }
//   people    known names          { [name]: { n: times used, t: last used (ms) } }
//   usage     entry shortcuts      { "typeId|slotId": { n, t } }
//   gone      deletions            { [eventId]: ms }, so that merging two devices never revives an event
//   stats     hours summary rules  (see stats.js)
//
// An event inherits everything from its type (slot times, fields shown, colour, title template);
// only its date and field values change from one event to the next.
import { formatTime, timeToMinutes } from "./dates.js";
import { t } from "../i18n/index.js";

const SCHEMA_VERSION = 1;

/** The 11 Google Calendar event colours (id = Google API colorId). */
export const COLORS = ["9", "7", "10", "2", "5", "6", "11", "4", "3", "1", "8"].map((id) => ({
  id,
  hex: {
    1: "#7986cb",
    2: "#33b679",
    3: "#8e24aa",
    4: "#e67c73",
    5: "#f6bf26",
    6: "#f4511e",
    7: "#039be5",
    8: "#616161",
    9: "#3f51b5",
    10: "#0b8043",
    11: "#d50000",
  }[id],
  get name() {
    return t(`color.${id}`);
  },
}));

export const colorById = (id) => COLORS.find((color) => color.id === id) || COLORS[0];

/**
 * Time zones offered for exports. `std`/`dst` are UTC offsets in minutes; `rule` names the
 * daylight-saving rule used to write the VTIMEZONE block of .ics files (see ics.js).
 */
export const TIMEZONES = [
  { id: "Europe/London", std: 0, dst: 60, rule: "eu", names: ["GMT", "BST"] },
  { id: "Europe/Paris", std: 60, dst: 120, rule: "eu", names: ["CET", "CEST"] },
  { id: "Europe/Helsinki", std: 120, dst: 180, rule: "eu", names: ["EET", "EEST"] },
  { id: "America/New_York", std: -300, dst: -240, rule: "us", names: ["EST", "EDT"] },
  { id: "America/Chicago", std: -360, dst: -300, rule: "us", names: ["CST", "CDT"] },
  { id: "America/Denver", std: -420, dst: -360, rule: "us", names: ["MST", "MDT"] },
  { id: "America/Los_Angeles", std: -480, dst: -420, rule: "us", names: ["PST", "PDT"] },
  { id: "America/Martinique", std: -240, dst: null },
  { id: "America/Cayenne", std: -180, dst: null },
  { id: "Indian/Reunion", std: 240, dst: null },
  { id: "Indian/Mayotte", std: 180, dst: null },
  { id: "Pacific/Noumea", std: 660, dst: null },
  { id: "Pacific/Tahiti", std: -600, dst: null },
  { id: "floating", std: 0, dst: null },
].map((zone) => ({
  ...zone,
  get label() {
    return t(`tz.${zone.id}`);
  },
}));

/** Device time zone if it is in the list, otherwise "floating" (local time of the calendar). */
export function defaultTimeZone() {
  try {
    const id = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (TIMEZONES.some((zone) => zone.id === id)) {
      return id;
    }
  } catch {}
  return "floating";
}

let idCounter = 0;

/** Unique id, e.g. "ev_lq2x8k3a9f1". */
export function newId(prefix = "x") {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${idCounter.toString(36)}`;
}

/** Lower-case ASCII identifier for template placeholders: "Team leader" → "team_leader". */
export function slugify(text) {
  return (
    text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "field"
  );
}

export function emptyState() {
  return {
    v: SCHEMA_VERSION,
    rev: 0,
    settings: {
      calName: "AgendApp",
      tz: defaultTimeZone(),
      lang: "auto",
      theme: "auto",
      exportGrouping: "perColor",
      allDayEndExclusive: true,
      gcalCalendarId: "",
      haptics: true,
    },
    groups: [],
    slots: [],
    fields: [],
    types: [],
    rules: [],
    events: [],
    people: {},
    usage: {},
    gone: {},
  };
}

/** Settings that belong to the device and are kept when data comes from elsewhere. */
export const DEVICE_SETTINGS = ["theme", "haptics", "lang"];

export const deviceSettings = (settings) =>
  Object.fromEntries(DEVICE_SETTINGS.filter((key) => key in settings).map((key) => [key, settings[key]]));

/** Completes a loaded state (older version, imported file) with default values. */
export function normalizeState(state) {
  const base = emptyState();
  if (!state || typeof state != "object") {
    return base;
  }
  const merged = { ...base, ...state, settings: { ...base.settings, ...(state.settings || {}) } };
  for (const key of ["groups", "slots", "fields", "types", "rules", "events"]) {
    if (!Array.isArray(merged[key])) {
      merged[key] = [];
    }
  }
  for (const key of ["people", "usage", "gone"]) {
    if (!merged[key] || typeof merged[key] != "object") {
      merged[key] = {};
    }
  }
  merged.types = merged.types.map((type) => ({
    alarms: [],
    days: 1,
    snapWeek: false,
    times: {},
    location: "",
    descTpl: "",
    ...type,
    fields: type.fields || [],
    slotIds: type.slotIds || [],
  }));
  merged.events = merged.events.map((ev) => ({
    values: {},
    review: {},
    note: "",
    status: "new",
    seq: 0,
    days: 1,
    ...ev,
  }));
  merged.v = SCHEMA_VERSION;
  return merged;
}

const findById = (list, id) => list.find((item) => item.id === id);

export const findSlot = (state, id) => findById(state.slots, id);

export const findType = (state, id) => findById(state.types, id);

export const findField = (state, id) => findById(state.fields, id);

export function slotGroupId(state, slotId) {
  return findSlot(state, slotId)?.groupId ?? null;
}

/** A slot that ends before it starts (19:00 → 07:30) ends the next day. */
export function endsNextDay(start, end) {
  return timeToMinutes(end) <= timeToMinutes(start);
}

/** Times of a slot, possibly overridden by the type: { start, end, nextDay }. */
export function slotTimes(state, type, slotId) {
  const slot = findSlot(state, slotId);
  if (!slot) {
    return null;
  }
  const custom = type?.times?.[slotId];
  const start = custom?.start || slot.start;
  const end = custom?.end || slot.end;
  return { start, end, nextDay: endsNextDay(start, end) };
}

/** Fields shown for this type on this slot: [{ field, required }]. */
export function typeFields(state, typeId, slotId) {
  const type = findType(state, typeId);
  if (!type) {
    return [];
  }
  const result = [];
  for (const field of type.fields) {
    const def = findField(state, field.fieldId);
    const shownOnSlot = !field.slotIds || !slotId || field.slotIds.includes(slotId);
    if (def && shownOnSlot) {
      result.push({ field: def, required: !!field.required });
    }
  }
  return result;
}

export const isPeopleField = (field) => field.kind === "people" || field.kind === "person";

/** Value of a field: a list of names for people fields, text otherwise. */
export function fieldValue(ev, fieldId, field) {
  const raw = ev.values?.[fieldId];
  return field && isPeopleField(field) ? (Array.isArray(raw) ? raw : raw ? [String(raw)] : []) : (raw ?? "");
}

export const isValidTime = (value) => typeof value == "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function formatFieldValue(field, value) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  const text = String(value ?? "").trim();
  return field?.kind === "time" ? (isValidTime(text) ? formatTime(text) : "") : text;
}

export const isEmptyValue = (value) =>
  Array.isArray(value) ? value.length === 0 : !String(value ?? "").trim();

/** Which setup steps are done (first-run checklist). */
export function setupProgress(state) {
  return {
    slots: state.slots.length > 0,
    fields: state.fields.length > 0,
    types: state.types.length > 0,
    rules: state.rules.length > 0,
  };
}

/** Adds or refreshes names in the list of known names (`people`). Case is ignored. */
export function recordPeople(state, names, now = Date.now()) {
  const people = { ...state.people };
  for (const raw of names) {
    const name = raw.trim();
    if (!name) {
      continue;
    }
    const key = Object.keys(people).find((known) => known.toLowerCase() === name.toLowerCase()) || name;
    const prev = people[key] || { n: 0, t: 0 };
    people[key] = { n: prev.n + 1, t: now };
  }
  return people;
}
