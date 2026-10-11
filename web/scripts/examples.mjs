// Generates the example profiles: complete setups with made-up schedules over ten weeks around
// today, in English (examples/*.json) and French (examples/fr/*.json). They are not bundled with
// the app; load one with Settings › Backup & restore › Restore from a file.
// Usage: npm run examples               (dates around today)
//        npm run examples -- 2026-10-15
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setLanguage } from "../src/i18n/index.js";
import { addDays, parseIso, weekStart } from "../src/lib/dates.js";
import { emptyState, normalizeState } from "../src/lib/model.js";
import { addEvents, eventsFromForm } from "../src/lib/events.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, "../../examples");
const today = process.argv[2] || new Date().toISOString().slice(0, 10);
const LANGS = { en: OUT, fr: path.join(OUT, "fr") };

/** Text in both languages; resolved by `localize`. */
const L = (en, fr) => ({ $en: en, $fr: fr });
const localize = (value, lang) => {
  if (Array.isArray(value)) return value.map((item) => localize(item, lang));
  if (value && typeof value === "object") {
    if ("$en" in value) return value[`$${lang}`];
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, localize(item, lang)]));
  }
  return value;
};

// Deterministic pseudo-random generator: the same files for the same date.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const pick = (rand, list, n = 1) => {
  const copy = [...list];
  const out = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
  return out;
};

// First name + initial: obviously made-up names.
const ROSTER = [
  "Camille R.", "Hugo M.", "Inès B.", "Lucas D.", "Léa F.", "Nathan G.", "Chloé P.", "Théo L.", "Manon S.",
  "Enzo V.", "Jade C.", "Louis T.", "Sarah K.", "Noah A.", "Emma J.", "Tom N.", "Zoé H.", "Adam E.",
];

const type = (id, name, code, color, extra = {}) => ({
  id, name, code, color, kind: "slot", slotIds: [], fields: [], titleTpl: "{type} {slotCode}", descTpl: "",
  location: "", alarms: [], days: 1, snapWeek: false, times: {}, ...extra,
});
const allday = (id, name, code, color, extra = {}) =>
  type(id, name, code, color, { kind: "allday", titleTpl: "{type}", ...extra });
const uses = (...ids) => ids.map((fieldId) => ({ fieldId, slotIds: null, required: false }));
const REST = L("Rest", "Repos");

// ---------- Profiles ----------
const PROFILES = [
  {
    file: "nursing-12h.json",
    title: L("Nurse on 12-hour shifts (day / night)", "Infirmier·e en 12 h (jour / nuit)"),
    calName: L("Hospital", "Hôpital"),
    groups: [{ id: "g_d", name: L("Day", "Jour") }, { id: "g_n", name: L("Night", "Nuit") }],
    slots: [
      { id: "s_d", name: L("Day", "Jour"), code: L("D", "J"), start: "07:00", end: "19:00", groupId: "g_d" },
      { id: "s_n", name: L("Night", "Nuit"), code: "N", start: "19:00", end: "07:00", groupId: "g_n" },
    ],
    fields: [
      { id: "f_buddy", key: "buddy", label: L("Partner", "Binôme"), kind: "person", sticky: false },
      { id: "f_team", key: "team", label: L("Team", "Équipe"), kind: "people", sticky: true },
      { id: "f_charge", key: "charge", label: L("Charge nurse", "Cadre"), kind: "person", sticky: true },
      { id: "f_unit", key: "unit", label: L("Unit", "Unité"), kind: "text", sticky: false },
    ],
    types: [
      type("t_shift", L("Shift", "Garde"), "G", "7", { slotIds: ["s_d", "s_n"], fields: uses("f_buddy", "f_team", "f_charge", "f_unit"), titleTpl: "{type} {slotCode}[ · {unit}]", alarms: [60] }),
      allday("t_rest", REST, "R", "8"),
      allday("t_leave", L("Leave", "Congé"), L("AL", "CA"), "5", { days: 7, snapWeek: true }),
      allday("t_training", L("Training", "Formation"), L("TRN", "FOR"), "3"),
    ],
    rules: [
      { id: "r_1", kind: "propose", enabled: true, name: L("After a night: rest the next day", "Après une nuit : repos le lendemain"), when: { typeIds: ["t_shift"], slotIds: ["s_n"] }, then: { typeId: "t_rest", slotId: "same", dayOffset: 1, copy: "none", clear: [], set: {}, mode: "suggest" } },
    ],
    stats: { types: { t_shift: { pause: 30 } } },
    // 7-day cycle: D D N N R R R
    plan: (i) => [["t_shift", "s_d"], ["t_shift", "s_d"], ["t_shift", "s_n"], ["t_shift", "s_n"], ["t_rest"], ["t_rest"], ["t_rest"]][i % 7],
    values: (rand) => ({ f_buddy: pick(rand, ROSTER), f_team: pick(rand, ROSTER, 3), f_charge: pick(rand, ROSTER.slice(0, 3)), f_unit: pick(rand, [L("ICU", "Réanimation"), L("Emergency", "Urgences"), L("Cardiology", "Cardiologie")])[0] }),
  },
  {
    file: "factory-3x8.json",
    title: L("Factory team on rotating 8-hour shifts", "Équipe postée en 3×8"),
    calName: L("Plant", "Usine"),
    groups: [{ id: "g_day", name: L("Day", "Jour") }, { id: "g_night", name: L("Night", "Nuit") }],
    slots: [
      { id: "s_m", name: L("Morning", "Matin"), code: "M", start: "05:00", end: "13:00", groupId: "g_day" },
      { id: "s_a", name: L("Afternoon", "Après-midi"), code: L("A", "AM"), start: "13:00", end: "21:00", groupId: "g_day" },
      { id: "s_n", name: L("Night", "Nuit"), code: "N", start: "21:00", end: "05:00", groupId: "g_night" },
    ],
    fields: [
      { id: "f_lead", key: "lead", label: L("Team leader", "Chef d'équipe"), kind: "person", sticky: true },
      { id: "f_team", key: "team", label: L("Team", "Équipe"), kind: "people", sticky: true },
      { id: "f_line", key: "line", label: L("Line", "Ligne"), kind: "text", sticky: false },
      { id: "f_cover", key: "cover", label: L("Covering for", "Remplacement de"), kind: "person", sticky: false },
    ],
    types: [
      type("t_shift", L("Shift", "Poste"), "P", "9", { slotIds: ["s_m", "s_a", "s_n"], fields: uses("f_lead", "f_team", "f_line", "f_cover"), titleTpl: "{slot}[ · {line}]" }),
      allday("t_rest", REST, "R", "8"),
      allday("t_safety", L("Safety training", "Formation sécurité"), L("ST", "FS"), "2"),
    ],
    rules: [],
    // Rotation: 5 mornings, 2 off, 5 afternoons, 2 off, 5 nights, 2 off
    plan: (i) => {
      const k = i % 21;
      return k % 7 < 5 ? ["t_shift", ["s_m", "s_a", "s_n"][Math.floor(k / 7)]] : ["t_rest"];
    },
    values: (rand) => ({ f_lead: ["Hugo M."], f_team: pick(rand, ROSTER.slice(4, 12), 4), f_line: pick(rand, [L("Line 1", "Ligne 1"), L("Line 2", "Ligne 2"), L("Packing", "Emballage")])[0] }),
  },
  {
    file: "firefighters-24h.json",
    title: L("Firefighter on 24-hour duty", "Sapeur-pompier : gardes de 24 h"),
    calName: L("Station", "Caserne"),
    groups: [{ id: "g_g", name: L("Duty", "Garde") }],
    slots: [
      { id: "s_24", name: L("24-hour duty", "Garde 24 h"), code: "24H", start: "08:00", end: "08:00", groupId: "g_g" },
      { id: "s_day", name: L("Day", "Journée"), code: L("D", "J"), start: "08:00", end: "18:00", groupId: "g_g" },
    ],
    fields: [
      { id: "f_chief", key: "chief", label: L("Duty officer", "Chef de garde"), kind: "person", sticky: true },
      { id: "f_amb", key: "ambulance", label: L("Ambulance crew", "Équipage VSAV"), kind: "people", sticky: false },
      { id: "f_engine", key: "engine", label: L("Engine crew", "Équipage FPT"), kind: "people", sticky: false },
    ],
    types: [
      type("t_duty", L("Duty", "Garde"), "G", "11", { slotIds: ["s_24"], fields: uses("f_chief", "f_amb", "f_engine"), titleTpl: L("{type} 24h[ · {chief}]", "{type} 24 h[ · {chief}]"), alarms: [120] }),
      type("t_drill", L("Drill", "Manœuvre"), L("DRL", "MAN"), "6", { slotIds: ["s_day"], fields: uses("f_chief"), titleTpl: "{type}" }),
      allday("t_rest", REST, "R", "8"),
      allday("t_oncall", L("On call", "Astreinte"), L("OC", "AST"), "1"),
    ],
    rules: [
      { id: "r_1", kind: "propose", enabled: true, name: L("After duty: rest", "Après une garde : repos"), when: { typeIds: ["t_duty"], slotIds: [] }, then: { typeId: "t_rest", slotId: "same", dayOffset: 1, copy: "none", clear: [], set: {}, mode: "auto" } },
    ],
    plan: (i) => [["t_duty", "s_24"], ["t_rest"], ["t_oncall"], ["t_drill", "s_day"], null, ["t_duty", "s_24"], ["t_rest"], null][i % 8],
    values: (rand) => ({ f_chief: pick(rand, ROSTER.slice(0, 2)), f_amb: pick(rand, ROSTER, 3), f_engine: pick(rand, ROSTER, 4) }),
  },
  {
    file: "patrol.json",
    title: L("Patrols (security, police, armed forces…)", "Patrouilles (sécurité, police, armée…)"),
    calName: L("Patrols", "Patrouilles"),
    groups: [{ id: "g_day", name: L("Day", "Jour") }, { id: "g_night", name: L("Night", "Nuit") }],
    slots: [
      { id: "s_m", name: L("Morning", "Matin"), code: "M", start: "07:00", end: "13:00", groupId: "g_day" },
      { id: "s_a", name: L("Afternoon", "Après-midi"), code: L("A", "AM"), start: "13:00", end: "19:00", groupId: "g_day" },
      { id: "s_n", name: L("Night", "Nuit"), code: "N", start: "19:00", end: "07:00", groupId: "g_night" },
    ],
    fields: [
      { id: "f_lead", key: "lead", label: L("Patrol leader", "Chef de patrouille"), kind: "person", sticky: false },
      { id: "f_crew", key: "crew", label: L("Crew", "Équipiers"), kind: "people", sticky: true },
      { id: "f_sector", key: "sector", label: L("Sector", "Secteur"), kind: "text", sticky: false },
      { id: "f_back", key: "back", label: L("Back on duty", "Reprise"), kind: "time", sticky: false },
    ],
    types: [
      type("t_patrol", L("Patrol", "Patrouille"), "PAT", "9", { slotIds: ["s_m", "s_a", "s_n"], fields: uses("f_lead", "f_crew", "f_sector", "f_back"), titleTpl: "{type} {slotCode}[ · {crew}]", alarms: [30] }),
      type("t_desk", L("Desk duty", "Permanence"), L("DESK", "PERM"), "10", { slotIds: ["s_m", "s_a"], fields: uses("f_lead"), titleTpl: "{type} {slotCode}" }),
      allday("t_rest", REST, "R", "8", { days: 2 }),
      allday("t_leave", L("Leave", "Permission"), L("LV", "PL"), "5", { days: 7, snapWeek: true }),
    ],
    rules: [
      { id: "r_1", kind: "propose", enabled: true, name: L("Morning patrol → afternoon desk duty", "Patrouille du matin → permanence l'après-midi"), when: { typeIds: ["t_patrol"], slotIds: ["s_m"] }, then: { typeId: "t_desk", slotId: "s_a", dayOffset: 0, copy: "all", clear: [], set: {}, mode: "suggest" } },
      { id: "r_2", kind: "prefill", enabled: true, name: L("Night: the day crew", "Nuit : équipiers du jour"), when: { typeIds: null, slotIds: ["s_n"] }, then: { fieldId: "f_crew", sources: [{ fieldId: "f_crew", groupIds: ["g_day"], typeIds: null }], mode: "fill", review: true } },
    ],
    plan: (i) => [["t_patrol", "s_m"], ["t_patrol", "s_a"], ["t_patrol", "s_n"], ["t_rest"], null, ["t_desk", "s_m"], ["t_patrol", "s_a"]][i % 7],
    values: (rand) => ({ f_lead: pick(rand, ROSTER.slice(0, 4)), f_crew: pick(rand, ROSTER.slice(4), 2), f_sector: pick(rand, [L("North", "Nord"), L("Centre", "Centre"), L("South", "Sud")])[0] }),
  },
  {
    file: "transit.json",
    title: L("Bus or tram driver (split shifts)", "Conducteur de bus ou de tram (services coupés)"),
    calName: L("Transit", "Réseau"),
    groups: [{ id: "g", name: L("Day", "Journée") }],
    slots: [
      { id: "s_m", name: L("Morning", "Matin"), code: "M", start: "05:45", end: "10:15", groupId: "g" },
      { id: "s_e", name: L("Evening", "Soir"), code: L("E", "S"), start: "16:00", end: "20:30", groupId: "g" },
      { id: "s_d", name: L("Day", "Journée"), code: L("D", "J"), start: "08:30", end: "16:30", groupId: "g" },
    ],
    fields: [
      { id: "f_line", key: "line", label: L("Line", "Ligne"), kind: "text", sticky: false },
      { id: "f_vehicle", key: "vehicle", label: L("Vehicle", "Véhicule"), kind: "text", sticky: false },
      { id: "f_relief", key: "relief", label: L("Relief", "Relève"), kind: "person", sticky: false },
    ],
    types: [
      type("t_service", L("Service", "Service"), "SV", "7", { slotIds: ["s_m", "s_e", "s_d"], fields: uses("f_line", "f_vehicle", "f_relief"), titleTpl: L("Line {line} {slotCode}", "Ligne {line} {slotCode}"), alarms: [45] }),
      type("t_standby", L("Standby", "Réserve"), L("SB", "RES"), "1", { slotIds: ["s_d"], titleTpl: "{type}" }),
      allday("t_rest", REST, "R", "8"),
    ],
    rules: [
      { id: "r_1", kind: "propose", enabled: true, name: L("Split shift: morning → evening", "Service coupé : matin → soir"), when: { typeIds: ["t_service"], slotIds: ["s_m"] }, then: { typeId: "t_service", slotId: "s_e", dayOffset: 0, copy: ["f_line"], clear: [], set: {}, mode: "suggest" } },
    ],
    plan: (i) => [[["t_service", "s_m"], ["t_service", "s_e"]], [["t_service", "s_d"]], [["t_service", "s_m"], ["t_service", "s_e"]], [["t_standby", "s_d"]], [["t_rest"]], [["t_rest"]]][i % 6],
    values: (rand) => ({ f_line: pick(rand, ["4", "12", "T2"])[0], f_vehicle: String(400 + Math.floor(rand() * 60)), f_relief: pick(rand, ROSTER) }),
  },
  {
    file: "shared-custody.json",
    title: L("Shared custody and activities", "Garde alternée et activités"),
    calName: L("Family", "Famille"),
    groups: [{ id: "g", name: L("Activities", "Activités") }],
    slots: [
      { id: "s_wed", name: L("Wednesday afternoon", "Mercredi après-midi"), code: L("WED", "MER"), start: "13:30", end: "17:00", groupId: "g" },
      { id: "s_sat", name: L("Saturday morning", "Samedi matin"), code: "SAM", start: "09:00", end: "12:00", groupId: "g" },
    ],
    fields: [
      { id: "f_kids", key: "kids", label: L("Children", "Enfants"), kind: "people", sticky: false },
      { id: "f_with", key: "with", label: L("Accompanied by", "Accompagnateur"), kind: "person", sticky: false },
      { id: "f_place", key: "place", label: L("Place", "Lieu"), kind: "text", sticky: false },
    ],
    types: [
      allday("t_week", L("Week with the children", "Semaine avec les enfants"), L("KIDS", "ENF"), "2", { days: 7, snapWeek: true }),
      type("t_activity", L("Activity", "Activité"), "ACT", "6", { slotIds: ["s_wed", "s_sat"], fields: uses("f_kids", "f_with", "f_place"), titleTpl: "{type}[ · {place}]" }),
    ],
    rules: [],
    stats: { types: { t_week: { cat: "ignore" } } },
    plan: (i) => {
      const dow = i % 7;
      const out = [];
      if (dow === 0 && Math.floor(i / 7) % 2 === 0) out.push(["t_week"]);
      if (dow === 2) out.push(["t_activity", "s_wed"]);
      if (dow === 5) out.push(["t_activity", "s_sat"]);
      return out;
    },
    values: () => ({ f_kids: ["Jade", "Tom"], f_with: ["Camille R."], f_place: L("Swimming pool", "Piscine") }),
  },
];
// Fix the Saturday code in English (SAM is French).
PROFILES[5].slots[1].code = L("SAT", "SAM");

function buildProfile(source, lang, seed) {
  setLanguage(lang);
  const profile = localize({ ...source, plan: undefined, values: undefined }, lang);
  const rand = rng(seed);
  let state = emptyState();
  state.settings = { ...state.settings, calName: profile.calName, tz: lang === "fr" ? "Europe/Paris" : "floating" };
  Object.assign(state, {
    groups: profile.groups,
    slots: profile.slots,
    fields: profile.fields,
    types: profile.types,
    rules: profile.rules,
  });
  if (profile.stats) state.stats = profile.stats;
  state.people = Object.fromEntries(ROSTER.map((name, i) => [name, { n: 0, t: i }]));
  const { y, m } = parseIso(today);
  // Ten weeks, starting two weeks before the Monday of this month's first week.
  const first = addDays(weekStart(`${y}-${String(m).padStart(2, "0")}-01`), -14);
  let createdAt = Date.parse(first + "T12:00:00Z");
  for (let i = 0; i < 70; i++) {
    const date = addDays(first, i);
    let entries = source.plan(i);
    if (!entries || !entries.length) continue;
    if (!Array.isArray(entries[0])) entries = [entries];
    for (const entry of entries) {
      if (!entry) continue;
      const [typeId, slotId = null] = entry;
      const type = state.types.find((x) => x.id === typeId);
      if (type.kind === "allday" && type.snapWeek && date !== weekStart(date)) continue;
      const values = localize(source.values(rand), lang);
      const touched = {};
      for (const def of type.fields) if (values[def.fieldId] != null) touched[def.fieldId] = values[def.fieldId];
      const events = eventsFromForm(state, { typeId, slotId, dates: [date], days: type.days, note: "", touched }).map(
        (ev) => ({ ...ev, createdAt: createdAt++, status: date < today ? "exported" : "new" }),
      );
      state = addEvents(state, events);
    }
  }
  state.rev = createdAt;
  return normalizeState(state);
}

const README = {
  en: (rows) => `# Example profiles

**Made-up** schedules, to try AgendApp without entering your own organisation. All names are invented.
French versions are in [fr/](fr/).

In the app: **Settings › Backup & restore › Restore from a file**, then pick a file. Your current data
is replaced (you can undo right after, or make a backup first).

| File | Profile | Content |
|---|---|---|
${rows}

Generated on ${today} by \`web/scripts/examples.mjs\` (\`npm run examples\` regenerates them around another date).
`,
  fr: (rows) => `# Profils d'exemple

Plannings **fictifs**, pour essayer AgendApp sans saisir sa propre organisation. Les noms sont inventés.

Dans l'app : **Réglages › Sauvegarde et restauration › Restaurer depuis un fichier**, puis choisis un
fichier. Tes données actuelles sont remplacées (tu peux annuler juste après, ou faire une sauvegarde avant).

| Fichier | Profil | Contenu |
|---|---|---|
${rows}

Générés le ${today} par \`web/scripts/examples.mjs\` (\`npm run examples\` pour les régénérer autour d'une autre date).
`,
};

for (const [lang, dir] of Object.entries(LANGS)) {
  fs.mkdirSync(dir, { recursive: true });
  const rows = PROFILES.map((profile, n) => {
    const state = buildProfile(profile, lang, 1000 + n);
    fs.writeFileSync(path.join(dir, profile.file), JSON.stringify(state, null, 1));
    console.log(`${lang}/${profile.file}: ${state.events.length} events`);
    const counts =
      lang === "fr"
        ? `${state.types.length} types, ${state.rules.length} règle(s), ${state.events.length} événements`
        : `${state.types.length} types, ${state.rules.length} rule(s), ${state.events.length} events`;
    return `| [${profile.file}](${profile.file}) | ${localize(profile.title, lang)} | ${counts} |`;
  });
  fs.writeFileSync(path.join(dir, "README.md"), README[lang](rows.join("\n")));
}
