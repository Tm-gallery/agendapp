// Built-in example template, offered on first launch: a generic shift-work setup (slots, fields,
// types and rules) to adapt. Full demo profiles with events live in examples/ at the repository root.
import { emptyState } from "./model.js";
import { t } from "../i18n/index.js";

const type = (fields) => ({
  slotIds: [],
  fields: [],
  descTpl: "",
  location: "",
  alarms: [],
  days: 1,
  snapWeek: false,
  times: {},
  ...fields,
});

const field = (fieldId, slotIds = null) => ({ fieldId, slotIds, required: false });

/** Example configuration, with names in the current language. */
export function exampleState() {
  const state = emptyState();
  state.groups = [
    { id: "g_day", name: t("example.group.day") },
    { id: "g_night", name: t("example.group.night") },
  ];
  state.slots = [
    { id: "s_m", name: t("example.slot.morning"), code: t("example.slot.morning.code"), start: "06:00", end: "14:00", groupId: "g_day" },
    { id: "s_a", name: t("example.slot.afternoon"), code: t("example.slot.afternoon.code"), start: "14:00", end: "22:00", groupId: "g_day" },
    { id: "s_n", name: t("example.slot.night"), code: t("example.slot.night.code"), start: "22:00", end: "06:00", groupId: "g_night" },
  ];
  state.fields = [
    { id: "f_lead", key: "lead", label: t("example.field.lead"), kind: "person", sticky: true },
    { id: "f_team", key: "team", label: t("example.field.team"), kind: "people", sticky: true },
    { id: "f_post", key: "post", label: t("example.field.post"), kind: "text", sticky: false },
  ];
  state.types = [
    type({
      id: "t_shift",
      name: t("example.type.shift"),
      code: t("example.type.shift.code"),
      color: "9",
      kind: "slot",
      slotIds: ["s_m", "s_a", "s_n"],
      fields: [field("f_lead"), field("f_team"), field("f_post")],
      titleTpl: "{type} {slotCode}[ · {team}]",
      alarms: [60],
    }),
    type({
      id: "t_oncall",
      name: t("example.type.oncall"),
      code: t("example.type.oncall.code"),
      color: "3",
      kind: "slot",
      slotIds: ["s_n"],
      fields: [field("f_lead")],
      titleTpl: "{type}[ · {lead}]",
    }),
    type({
      id: "t_training",
      name: t("example.type.training"),
      code: t("example.type.training.code"),
      color: "7",
      kind: "slot",
      slotIds: ["s_m"],
      fields: [field("f_post")],
      titleTpl: "{type}[ · {post}]",
    }),
    type({
      id: "t_rest",
      name: t("example.type.rest"),
      code: t("example.type.rest.code"),
      color: "8",
      kind: "allday",
      titleTpl: "{type}",
    }),
    type({
      id: "t_leave",
      name: t("example.type.leave"),
      code: t("example.type.leave.code"),
      color: "5",
      kind: "allday",
      titleTpl: "{type}",
      days: 7,
      snapWeek: true,
    }),
  ];
  state.rules = [
    {
      id: "r_rest",
      kind: "propose",
      enabled: true,
      name: t("example.rule.rest"),
      when: { typeIds: ["t_shift"], slotIds: ["s_n"] },
      then: { typeId: "t_rest", slotId: "same", dayOffset: 1, copy: "none", clear: [], set: {}, mode: "suggest" },
    },
    {
      id: "r_oncall",
      kind: "prefill",
      enabled: true,
      name: t("example.rule.oncall"),
      when: { typeIds: ["t_oncall"], slotIds: null },
      then: {
        fieldId: "f_lead",
        sources: [{ fieldId: "f_lead", groupIds: ["g_day"], typeIds: null }],
        mode: "suggest",
        review: true,
      },
    },
  ];
  return state;
}
