// Known names: add, remove, rename (merging duplicates and updating the events that use them).
import { isPeopleField } from "./model.js";

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Adds a name unless it is already known (case ignored). */
export function addPerson(state, name, now = Date.now()) {
  const clean = String(name).trim();
  return !clean || Object.keys(state.people).some((known) => sameName(known, clean))
    ? state
    : { ...state, people: { ...state.people, [clean]: { n: 0, t: now } } };
}

/** Removes a name from the list; events keep the name as entered. */
export function removePerson(state, name) {
  const people = { ...state.people };
  for (const known of Object.keys(people)) {
    if (sameName(known, name)) {
      delete people[known];
    }
  }
  return { ...state, people };
}

/**
 * Renames `from` to `to`, merging both entries if `to` already exists. With `inEvents`, the name is
 * also corrected in events, which go back to "to export" if they had been exported.
 */
export function renamePerson(state, from, to, { inEvents = true } = {}) {
  const clean = String(to).trim();
  if (!clean) {
    return state;
  }
  const people = {};
  let merged = null;
  for (const [known, entry] of Object.entries(state.people)) {
    if (sameName(known, from) || sameName(known, clean)) {
      merged = merged ? { n: merged.n + entry.n, t: Math.max(merged.t, entry.t) } : { ...entry };
    } else {
      people[known] = entry;
    }
  }
  people[clean] = merged || { n: 0, t: Date.now() };
  let events = state.events;
  if (inEvents) {
    const peopleFields = state.fields.filter(isPeopleField);
    events = state.events.map((ev) => {
      let changed = false;
      const values = { ...ev.values };
      for (const field of peopleFields) {
        const names = values[field.id];
        if (!Array.isArray(names) || !names.some((name) => sameName(name, from))) {
          continue;
        }
        const next = [];
        for (const name of names) {
          const renamed = sameName(name, from) ? clean : name;
          if (!next.some((existing) => sameName(existing, renamed))) {
            next.push(renamed);
          }
        }
        values[field.id] = next;
        changed = true;
      }
      return changed
        ? {
            ...ev,
            values,
            status: ev.status === "exported" ? "new" : ev.status,
            seq: (ev.seq || 0) + (ev.status === "exported" ? 1 : 0),
          }
        : ev;
    });
  }
  return { ...state, people, events };
}

/** Number of events that mention this name. */
export function countEventsWithName(state, name) {
  const peopleFields = state.fields.filter(isPeopleField);
  return state.events.filter((ev) =>
    peopleFields.some(
      (field) => Array.isArray(ev.values?.[field.id]) && ev.values[field.id].some((n) => sameName(n, name)),
    ),
  ).length;
}
