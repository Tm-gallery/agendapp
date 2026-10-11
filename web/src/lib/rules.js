// Rules: what saves typing when entering events.
//   - prefill: a field takes the names found in other events of the same day
//     (e.g. the night team = the day team);
//   - propose: creating an event suggests another one (e.g. a night shift → a rest day the day
//     after), to confirm or created directly.
// Also here: "sticky" fields (same value for every slot of a group on the same day) and name
// suggestions.
import { addDays, weekdayIndex } from "./dates.js";
import { t } from "../i18n/index.js";
import {
  fieldValue,
  findField,
  findSlot,
  findType,
  isEmptyValue,
  isPeopleField,
  newId,
  slotGroupId,
  typeFields,
} from "./model.js";

const cloneValue = (value) => (Array.isArray(value) ? [...value] : value);

/** Does the rule's "When I create…" condition match this event? (empty = everything) */
function ruleMatches(when, ev) {
  if (!when) {
    return true;
  }
  const allows = (list, value) => !list || !list.length || list.includes(value);
  return (
    allows(when.typeIds, ev.typeId) &&
    allows(when.slotIds, ev.slotId) &&
    (!ev.date || allows(when.dows, weekdayIndex(ev.date)))
  );
}

const nameKey = (name) => name.trim().toLowerCase();

/** Names without duplicates (case and spaces ignored), in their original order. */
export function uniqueNames(names) {
  const seen = new Set();
  const result = [];
  for (const name of names) {
    const key = nameKey(name);
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(name.trim());
    }
  }
  return result;
}

/** Names found in the source fields of a prefill rule, among `events`. */
function collectSourceNames(state, sources, events) {
  const names = [];
  for (const source of sources || []) {
    const field = findField(state, source.fieldId);
    if (field) {
      for (const other of events) {
        if (
          (source.typeIds && source.typeIds.length && !source.typeIds.includes(other.typeId)) ||
          (source.groupIds &&
            source.groupIds.length &&
            !source.groupIds.includes(slotGroupId(state, other.slotId)))
        ) {
          continue;
        }
        const value = fieldValue(other, field.id, field);
        if (Array.isArray(value)) {
          names.push(...value);
        } else if (String(value).trim()) {
          names.push(String(value).trim());
        }
      }
    }
  }
  return uniqueNames(names);
}

/**
 * Prefilled values for a new event: sticky fields from the same slot group, then prefill rules.
 * Returns { values, review (fields to double-check), suggestions (chips) }.
 */
export function prefillFor(state, draft) {
  const defs = typeFields(state, draft.typeId, draft.slotId);
  const shown = new Set(defs.map((def) => def.field.id));
  const groupId = draft.slotId ? slotGroupId(state, draft.slotId) : null;
  const values = {};
  const review = {};
  const suggestions = {};
  const sameDay = state.events.filter((ev) => ev.id !== draft.id && ev.date === draft.date);
  for (const { field } of defs) {
    if (!field.sticky || !groupId) {
      continue;
    }
    const latest = sameDay
      .filter(
        (other) =>
          slotGroupId(state, other.slotId) === groupId && !isEmptyValue(fieldValue(other, field.id, field)),
      )
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
    if (latest) {
      values[field.id] = cloneValue(fieldValue(latest, field.id, field));
    }
  }
  for (const rule of state.rules) {
    if (rule.kind !== "prefill" || rule.enabled === false || !ruleMatches(rule.when, draft)) {
      continue;
    }
    const fieldId = rule.then?.fieldId;
    if (!fieldId || !shown.has(fieldId)) {
      continue;
    }
    const target = findField(state, fieldId);
    const names = collectSourceNames(state, rule.then.sources, sameDay);
    if (names.length) {
      if (rule.then.mode === "suggest") {
        suggestions[fieldId] = uniqueNames([...(suggestions[fieldId] || []), ...names]);
        continue;
      }
      if (isEmptyValue(values[fieldId])) {
        values[fieldId] = isPeopleField(target)
          ? target.kind === "person"
            ? names.slice(0, 1)
            : names
          : names.join(", ");
        if (rule.then.review !== false) {
          review[fieldId] = true;
        }
      }
    }
  }
  return { values, review, suggestions };
}

/**
 * Name suggestions for a field: people already scheduled that day (with their role and slot),
 * then recently used names.
 */
export function nameSuggestions(state, { date, draftId, exclude = [], recentLimit = 8 }) {
  const excluded = new Set(exclude.map(nameKey));
  const byName = new Map();
  for (const ev of state.events) {
    if (ev.id === draftId || ev.date !== date) {
      continue;
    }
    const slot = findSlot(state, ev.slotId);
    for (const field of state.fields) {
      if (isPeopleField(field)) {
        for (const name of fieldValue(ev, field.id, field)) {
          const key = nameKey(name);
          if (!key || excluded.has(key)) {
            continue;
          }
          const entry = byName.get(key) || { name, roles: new Map(), n: 0 };
          const codes = entry.roles.get(field.label) || [];
          if (slot && !codes.includes(slot.code)) {
            codes.push(slot.code);
          }
          entry.roles.set(field.label, codes);
          entry.n++;
          byName.set(key, entry);
        }
      }
    }
  }
  for (const entry of byName.values()) {
    entry.tags = [...entry.roles].map(([role, codes]) =>
      codes.length ? `${role} ${codes.join("+")}` : role,
    );
  }
  const day = [...byName.values()].sort((a, b) => b.n - a.n);
  const dayKeys = new Set(day.map((entry) => nameKey(entry.name)));
  const recent = Object.entries(state.people || {})
    .filter(([name]) => !excluded.has(nameKey(name)) && !dayKeys.has(nameKey(name)))
    .sort((a, b) => b[1].t - a[1].t)
    .slice(0, recentLimit)
    .map(([name]) => ({ name, tags: [] }));
  return { day, recent };
}

/** All known names, most recently used first. */
export function knownNames(state) {
  return Object.entries(state.people || {})
    .sort((a, b) => b[1].t - a[1].t)
    .map(([name]) => name);
}

const copyValue = (value) => (Array.isArray(value) ? [...value] : value);

/** Identifies "the same event": same day, type and slot (used to detect duplicates). */
export const eventKey = (ev) => `${ev.date}|${ev.typeId}|${ev.slotId || ""}`;

/** Event proposed by `rule` from `ev`, or null if the rule does not apply. */
function proposalFromRule(state, ev, rule, now) {
  const then = rule.then || {};
  const type = findType(state, then.typeId);
  if (!type) {
    return null;
  }
  const date = addDays(ev.date, Number(then.dayOffset) || 0);
  let slotId = null;
  let days = 1;
  if (type.kind === "slot") {
    slotId = !then.slotId || then.slotId === "same" ? ev.slotId : then.slotId;
    if (!slotId || !type.slotIds.includes(slotId)) {
      return null;
    }
  } else {
    days = type.days || 1;
  }
  const defs = typeFields(state, type.id, slotId);
  const cleared = then.clear || [];
  const copy = then.copy ?? "all";
  const values = {};
  for (const { field } of defs) {
    if (cleared.includes(field.id)) {
      continue;
    }
    if (then.set && then.set[field.id] != null) {
      values[field.id] = copyValue(then.set[field.id]);
      continue;
    }
    if (copy === "all" || (Array.isArray(copy) && copy.includes(field.id))) {
      const value = fieldValue(ev, field.id, field);
      if (!isEmptyValue(value)) {
        values[field.id] = copyValue(value);
      }
    }
  }
  const proposal = {
    id: newId("ev"),
    typeId: type.id,
    slotId,
    date,
    days,
    values,
    review: {},
    note: "",
    status: "new",
    seq: 0,
    createdAt: now,
    origin: `rule:${rule.id}`,
    ruleName: rule.name || t("rules.unnamed"),
    auto: then.mode === "auto",
  };
  const prefill = prefillFor(state, proposal);
  for (const fieldId of Object.keys(prefill.values)) {
    if (!cleared.includes(fieldId) && isEmptyValue(values[fieldId])) {
      values[fieldId] = prefill.values[fieldId];
      if (prefill.review[fieldId]) {
        proposal.review[fieldId] = true;
      }
    }
  }
  return proposal;
}

/**
 * Every proposal triggered by a new event, in cascade (a proposal may trigger another one) up to
 * `maxDepth` levels. Proposals that duplicate an existing event are flagged `duplicate`.
 */
export function proposalsFor(state, source, { maxDepth = 2, now = Date.now() } = {}) {
  const proposals = [];
  const seen = new Set([eventKey(source)]);
  let working = state;
  const queue = [{ ev: source, depth: 0 }];
  while (queue.length) {
    const { ev, depth } = queue.shift();
    if (depth < maxDepth) {
      for (const rule of state.rules) {
        if (rule.kind !== "propose" || rule.enabled === false || !ruleMatches(rule.when, ev)) {
          continue;
        }
        const proposal = proposalFromRule(working, ev, rule, now);
        if (!proposal) {
          continue;
        }
        const key = eventKey(proposal);
        if (!seen.has(key)) {
          seen.add(key);
          proposal.duplicate = working.events.some((other) => eventKey(other) === key);
          proposals.push(proposal);
          if (!proposal.duplicate) {
            working = { ...working, events: [...working.events, proposal] };
            queue.push({ ev: proposal, depth: depth + 1 });
          }
        }
      }
    }
  }
  return proposals;
}

/** One-line summary of a rule: "When Night shift · any slot → suggest Rest, same slot (+1 d)". */
export function describeRule(state, rule) {
  const namesOf = (ids, list, fallback) =>
    !ids || !ids.length
      ? fallback
      : ids.map((id) => list.find((item) => item.id === id)?.name || "?").join(t("rules.or"));
  const when = `${namesOf(rule.when?.typeIds, state.types, t("rules.anyEvent"))} · ${namesOf(rule.when?.slotIds, state.slots, t("rules.anySlot"))}`;
  if (rule.kind === "propose") {
    const then = rule.then || {};
    const target = state.types.find((item) => item.id === then.typeId);
    const type = target?.name || "?";
    const slot =
      target?.kind === "allday"
        ? ""
        : `, ${
            then.slotId === "same" || !then.slotId
              ? t("rules.sameSlot")
              : state.slots.find((item) => item.id === then.slotId)?.name || "?"
          }`;
    const offset = then.dayOffset ? t("rules.offset", { n: `${then.dayOffset > 0 ? "+" : ""}${then.dayOffset}` }) : "";
    const action = t(then.mode === "auto" ? "rules.verb.create" : "rules.verb.suggest");
    return t("rules.describe.propose", { when, action, type, slot, offset });
  }
  const target = state.fields.find((field) => field.id === rule.then?.fieldId)?.label || "?";
  const sources = (rule.then?.sources || [])
    .map((source) => state.fields.find((field) => field.id === source.fieldId)?.label || "?")
    .join(" + ");
  const action = t(rule.then?.mode === "suggest" ? "rules.verb.suggestNames" : "rules.verb.prefill");
  return t("rules.describe.prefill", { when, action, target, sources: sources || "…" });
}
