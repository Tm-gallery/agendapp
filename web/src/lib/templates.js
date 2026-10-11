// Event titles and descriptions, built from each type's templates:
//   "{type} {slotCode}[ · {team}]" → "Shift M · Alex, Sam"
// {key} is replaced by the field value (or type, typeCode, slot, slotCode, date, note); a passage
// in square brackets disappears when one of its placeholders is empty.
import { formatDateShort } from "./dates.js";
import { fieldValue, findSlot, findType, formatFieldValue, isEmptyValue, isPeopleField, typeFields } from "./model.js";
import { t } from "../i18n/index.js";

const BASE_TITLE_TEMPLATE = "{type} {slotCode}";

/** Default title template: type and slot code, then the first names field if there is one. */
export function defaultTitleTemplate(state) {
  const people = state?.fields?.find(isPeopleField);
  return people ? `${BASE_TITLE_TEMPLATE}[ · {${people.key}}]` : BASE_TITLE_TEMPLATE;
}

/** Values available to templates for this event. */
function templateValues(state, ev) {
  const type = findType(state, ev.typeId);
  const slot = ev.slotId ? findSlot(state, ev.slotId) : null;
  const vars = {
    type: type?.name || "",
    typeCode: type?.code || type?.name || "",
    slot: slot?.name || "",
    slotCode: slot?.code || "",
    date: ev.date ? formatDateShort(ev.date) : "",
    note: ev.note || "",
  };
  for (const field of state.fields) {
    const value = fieldValue(ev, field.id, field);
    vars[field.key] = formatFieldValue(field, value);
  }
  return vars;
}

function renderTemplate(template, vars) {
  const placeholder = /\{(\w+)\}/g;
  return template
    .replace(/\[([^\[\]]*)\]/g, (_, inner) => {
      let missing = false;
      const filled = inner.replace(placeholder, (_m, key) => {
        const value = vars[key] ?? "";
        if (!String(value).trim()) {
          missing = true;
        }
        return value;
      });
      return missing ? "" : filled;
    })
    .replace(placeholder, (_, key) => vars[key] ?? "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, `\n`)
    .trim();
}

/** Event title (shown everywhere and exported). */
export function eventTitle(state, ev) {
  const type = findType(state, ev.typeId);
  return type
    ? renderTemplate(type.titleTpl || BASE_TITLE_TEMPLATE, templateValues(state, ev)) || type.name
    : t("common.event");
}

/** Exported description: the type's template, otherwise one "Field: value" line each, then the note. */
export function eventDescription(state, ev) {
  const type = findType(state, ev.typeId);
  if (!type) {
    return "";
  }
  if (type.descTpl && type.descTpl.trim()) {
    return renderTemplate(type.descTpl, templateValues(state, ev));
  }
  const lines = [];
  for (const { field } of typeFields(state, ev.typeId, ev.slotId)) {
    const value = fieldValue(ev, field.id, field);
    const text = formatFieldValue(field, value);
    if (text) {
      lines.push(t("template.fieldLine", { label: field.label, value: text }));
    }
  }
  if (ev.note && ev.note.trim()) {
    lines.push(ev.note.trim());
  }
  return lines.join(`\n`);
}

/** Placeholders offered under the title editor. */
export function templateVariables(state) {
  return [
    { k: "type", label: t("template.var.type") },
    { k: "typeCode", label: t("template.var.typeCode") },
    { k: "slot", label: t("template.var.slot") },
    { k: "slotCode", label: t("template.var.slotCode") },
    { k: "date", label: t("template.var.date") },
    ...state.fields.map((field) => ({ k: field.key, label: field.label })),
    { k: "note", label: t("template.var.note") },
  ];
}

/** "Team leader Alex · Location North gate", under the title of event cards. */
export function eventFieldsSummary(state, ev) {
  const parts = [];
  for (const { field } of typeFields(state, ev.typeId, ev.slotId)) {
    const value = fieldValue(ev, field.id, field);
    if (!isEmptyValue(value)) {
      parts.push(`${field.label} ${formatFieldValue(field, value)}`);
    }
  }
  return parts.join(" · ");
}

/** Short code shown in calendar cells: "SHIFT M". */
export function eventCode(state, ev) {
  const type = findType(state, ev.typeId);
  if (!type) {
    return "?";
  }
  const slot = ev.slotId ? findSlot(state, ev.slotId) : null;
  return slot ? `${type.code || type.name} ${slot.code}` : type.code || type.name;
}
