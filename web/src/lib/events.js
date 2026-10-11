// State operations: creating, editing and deleting events, export status, and small list helpers.
// All of them are pure: they return a new state (to pass to updateState) and never mutate the old one.
import { addDays, groupConsecutive, weekStart } from "./dates.js";
import { findType, isEmptyValue, isPeopleField, isValidTime, newId, recordPeople, typeFields } from "./model.js";
import { prefillFor } from "./rules.js";

const deepClone = (value) => JSON.parse(JSON.stringify(value));

/** Keeps only meaningful values for `defs`: trimmed names, valid times, non-empty text. */
export function cleanValues(state, typeId, slotId, values, defs) {
  const out = {};
  for (const { field } of defs) {
    const raw = values[field.id];
    if (isPeopleField(field)) {
      const names = (Array.isArray(raw) ? raw : raw ? [raw] : [])
        .map((name) => String(name).trim())
        .filter(Boolean);
      if (names.length) {
        out[field.id] = field.kind === "person" ? names.slice(0, 1) : names;
      }
    } else if (field.kind === "time") {
      if (isValidTime(raw)) {
        out[field.id] = raw;
      }
    } else if (!isEmptyValue(raw)) {
      out[field.id] = String(raw).trim();
    }
  }
  return out;
}

/**
 * Events to create for the chosen days. An all-day type covers each run of consecutive days (or
 * whole Monday-to-Sunday weeks when the type is set to "whole week").
 */
function buildEvents(state, { typeId, slotId, dates, values = {}, review = {}, note = "", days }) {
  const type = findType(state, typeId);
  if (!type) {
    return [];
  }
  const now = Date.now();
  const base = () => ({
    id: newId("ev"),
    typeId,
    values: deepClone(values),
    review: { ...review },
    note,
    status: "new",
    seq: 0,
    createdAt: now,
    origin: "manual",
  });
  if (type.kind !== "allday") {
    return [...new Set(dates)].sort().map((date) => ({ ...base(), slotId, date, days: 1 }));
  }
  if (type.snapWeek) {
    const mondays = [...new Set(dates.map(weekStart))].sort();
    return mondays.map((monday) => ({ ...base(), slotId: null, date: monday, days: 7 }));
  }
  return groupConsecutive(dates).map((run) => ({
    ...base(),
    slotId: null,
    date: run[0],
    days: run.length > 1 ? run.length : days || type.days || 1,
  }));
}

/**
 * Events produced by the entry form, one per chosen day. Fields the user edited keep their value;
 * the others are prefilled day by day (rules, sticky fields).
 */
export function eventsFromForm(state, form) {
  const defs = typeFields(state, form.typeId, form.slotId);
  const touched = form.touched || {};
  const drafts = buildEvents(state, {
    typeId: form.typeId,
    slotId: form.slotId,
    dates: form.dates,
    note: form.note,
    days: form.days,
  });
  return drafts.map((draft) => {
    const prefill = prefillFor(state, draft);
    const values = {};
    const review = {};
    for (const { field } of defs) {
      if (field.id in touched) {
        values[field.id] = touched[field.id];
      } else if (prefill.values[field.id] != null) {
        values[field.id] = prefill.values[field.id];
        if (prefill.review[field.id]) {
          review[field.id] = true;
        }
      }
    }
    const clean = cleanValues(state, form.typeId, form.slotId, values, defs);
    for (const fieldId of Object.keys(review)) {
      if (!(fieldId in clean)) {
        delete review[fieldId];
      }
    }
    return { ...draft, values: clean, review };
  });
}

/** Adds events, updating the list of known names and the entry shortcuts. */
export function addEvents(state, events) {
  const names = [];
  const usage = { ...state.usage };
  for (const ev of events) {
    for (const value of Object.values(ev.values || {})) {
      if (Array.isArray(value)) {
        names.push(...value);
      }
    }
    const key = `${ev.typeId}|${ev.slotId || ""}`;
    usage[key] = { n: (usage[key]?.n || 0) + 1, t: Date.now() };
  }
  return { ...state, events: [...state.events, ...events], people: recordPeople(state, names), usage };
}

/** Edits an event. If it was already exported, it goes back to "to export" with a new sequence number. */
export function updateEvent(state, id, patch) {
  const names = [];
  const events = state.events.map((ev) => {
    if (ev.id !== id) {
      return ev;
    }
    const updated = { ...ev, ...patch, at: Date.now() };
    if (ev.status === "exported") {
      updated.status = "new";
      updated.seq = (ev.seq || 0) + 1;
    }
    for (const value of Object.values(updated.values || {})) {
      if (Array.isArray(value)) {
        names.push(...value);
      }
    }
    return updated;
  });
  return { ...state, events, people: recordPeople(state, names) };
}

/** Deletes events and records when (so that merging with another device does not bring them back). */
export const deleteEvents = (state, ids) => {
  const removed = new Set(ids);
  const now = Date.now();
  const gone = { ...(state.gone || {}) };
  for (const id of removed) {
    gone[id] = now;
  }
  return { ...state, events: state.events.filter((ev) => !removed.has(ev.id)), gone };
};

/** Marks events as exported (`extra`: per-event calendar ids after a direct send). */
export const markExported = (state, ids, extra = {}) => {
  const set = new Set(ids);
  return {
    ...state,
    events: state.events.map((ev) =>
      set.has(ev.id) ? { ...ev, status: "exported", exportedAt: Date.now(), ...(extra[ev.id] || {}) } : ev,
    ),
  };
};

export const markNotExported = (state, ids) => {
  const set = new Set(ids);
  return { ...state, events: state.events.map((ev) => (set.has(ev.id) ? { ...ev, status: "new" } : ev)) };
};

/**
 * After a slot, field, type or group is deleted: removes the dangling references from types and
 * rules (and drops the rules that no longer make sense).
 */
export function pruneReferences(state) {
  const slotIds = new Set(state.slots.map((slot) => slot.id));
  const fieldIds = new Set(state.fields.map((field) => field.id));
  const typeIds = new Set(state.types.map((type) => type.id));
  const groupIds = new Set(state.groups.map((group) => group.id));
  const keepKnown = (ids, known) => ids && ids.filter((id) => known.has(id));

  const slots = state.slots.map((slot) =>
    groupIds.has(slot.groupId) ? slot : { ...slot, groupId: state.groups[0]?.id ?? null },
  );
  const types = state.types.map((type) => ({
    ...type,
    slotIds: keepKnown(type.slotIds, slotIds),
    fields: type.fields
      .filter((field) => fieldIds.has(field.fieldId))
      .map((field) => ({ ...field, slotIds: field.slotIds ? keepKnown(field.slotIds, slotIds) : field.slotIds })),
  }));
  const rules = state.rules
    .map((rule) => {
      const when = {
        ...rule.when,
        typeIds: rule.when?.typeIds ? keepKnown(rule.when.typeIds, typeIds) : null,
        slotIds: rule.when?.slotIds ? keepKnown(rule.when.slotIds, slotIds) : null,
      };
      if (rule.kind === "propose") {
        if (!typeIds.has(rule.then?.typeId)) {
          return null;
        }
        const then = { ...rule.then };
        if (then.slotId && then.slotId !== "same" && !slotIds.has(then.slotId)) {
          then.slotId = "same";
        }
        if (Array.isArray(then.copy)) {
          then.copy = keepKnown(then.copy, fieldIds);
        }
        then.clear = keepKnown(then.clear || [], fieldIds);
        return { ...rule, when, then };
      }
      if (!fieldIds.has(rule.then?.fieldId)) {
        return null;
      }
      const sources = (rule.then.sources || [])
        .filter((source) => fieldIds.has(source.fieldId))
        .map((source) => ({
          ...source,
          groupIds: source.groupIds ? keepKnown(source.groupIds, groupIds) : null,
          typeIds: source.typeIds ? keepKnown(source.typeIds, typeIds) : null,
        }));
      return { ...rule, when, then: { ...rule.then, sources } };
    })
    .filter(Boolean);
  return { ...state, slots, types, rules };
}

/** Replaces the item with the same id, or appends it. */
export const upsertById = (list, item) =>
  list.some((other) => other.id === item.id)
    ? list.map((other) => (other.id === item.id ? item : other))
    : [...list, item];

export const removeById = (list, id) => list.filter((item) => item.id !== id);

/** Moves an item one step up (-1) or down (+1). */
export const moveById = (list, id, delta) => {
  const from = list.findIndex((item) => item.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= list.length) {
    return list;
  }
  const copy = [...list];
  [copy[from], copy[to]] = [copy[to], copy[from]];
  return copy;
};

/** Copies of events shifted by `offset` days (not exported). */
export function copyEvents(events, offset) {
  const now = Date.now();
  return events.map((ev, i) => ({
    ...deepClone(ev),
    id: newId("ev"),
    date: addDays(ev.date, offset),
    status: "new",
    seq: 0,
    gcalId: undefined,
    exportedAt: undefined,
    createdAt: now + i,
    origin: "copy",
  }));
}
