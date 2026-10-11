// Android app: keeps a copy of the data for the native side (widgets, scheduled backup, watch) and
// turns shortcut, widget and watch links into navigation intents.
//
// This module runs before the state store is loaded (see bridge.js), so it only uses pure helpers
// and reads the saved state passed in by the bridge.
import { addDays, todayIso } from "../../lib/dates.js";
import { sendIntent } from "../../lib/intents.js";
import { colorById, fieldValue, findType, formatFieldValue, isEmptyValue, typeFields } from "../../lib/model.js";
import { periodTotals } from "../../lib/stats.js";
import { eventCode, eventDescription, eventTitle } from "../../lib/templates.js";
import { eventTiming } from "../../lib/timing.js";

const pad = (n) => String(n).padStart(2, "0");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Events already formatted for the native side (widgets and watch need no app logic):
 * { cal, at, items: [{ id, d, e, ad, s, f, t, c, ty, col, x, fl, ex }], stats: [...] }.
 */
function buildFeed(state) {
  const from = addDays(todayIso(), -62);
  const items = [];
  for (const ev of state.events || []) {
    if (!ev.date || ev.date < from) continue;
    const timing = eventTiming(state, ev);
    const type = findType(state, ev.typeId);
    if (!timing || !type) continue;
    let details = "";
    try {
      details = eventDescription(state, ev)
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" · ");
    } catch {}
    // Filled fields as [label, value] pairs, for the watch's event screen.
    const fields = typeFields(state, ev.typeId, ev.slotId)
      .map(({ field }) => [field.label, formatFieldValue(field, fieldValue(ev, field.id, field))])
      .filter(([, value]) => !isEmptyValue(value));
    if (ev.note?.trim()) fields.push(["", ev.note.trim()]);
    items.push({
      id: ev.id,
      d: timing.startDate,
      e: timing.endDate,
      ad: !!timing.allDay,
      s: timing.startTime || "",
      f: timing.endTime || "",
      t: eventTitle(state, ev),
      c: eventCode(state, ev),
      ty: type.name,
      col: colorById(type.color).hex,
      x: details,
      fl: fields,
      ex: ev.status === "exported",
    });
  }
  items.sort((a, b) => (a.d + (a.ad ? "" : a.s)).localeCompare(b.d + (b.ad ? "" : b.s)));
  // Monthly totals from last month to two months ahead, following the counting rules (watch).
  const stats = [];
  const [year, month] = todayIso().split("-").map(Number);
  for (let k = -1; k <= 2; k++) {
    const index = year * 12 + (month - 1) + k;
    const y = Math.floor(index / 12);
    const m = (index % 12) + 1;
    const next = index + 1;
    const totals = periodTotals(state, `${y}-${pad(m)}-01`, `${Math.floor(next / 12)}-${pad((next % 12) + 1)}-01`);
    stats.push({ ym: `${y}-${pad(m)}`, i: totals.minutes, c: totals.nights, d: totals.daysOff });
  }
  return { cal: state.settings?.calName || "AgendApp", at: Date.now(), items, stats };
}

/** Closes open dialogs and sheets (by tapping their scrim) before navigating. */
async function closeOverlays() {
  for (let i = 0; i < 6; i++) {
    const scrim =
      document.querySelector(".dlg-wrap .scrim") ||
      [...document.querySelectorAll("#layers .sheet-wrap:not(.out) > .scrim")].pop();
    if (!scrim) return;
    scrim.click();
    await sleep(230);
  }
}

export function initNative({ A, KEY, readJSON, stateHooks }) {
  if (!A || !A.persist) return;
  try {
    A.watchRefresh?.(); // refreshes the list of connected watches in the background
  } catch {}

  // Data copy for widgets, scheduled backups and the watch, written shortly after each change.
  let persistTimer = null;
  function persist(state, raw) {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      if (state) A.persist(raw, JSON.stringify(buildFeed(state)));
    }, 600);
  }
  stateHooks.push((state, raw) => persist(state, raw));
  window.addEventListener("load", () =>
    setTimeout(() => {
      const raw = localStorage.getItem(KEY);
      if (raw) persist(readJSON(KEY), raw);
    }, 300),
  );

  // Links from shortcuts, widgets and the watch: agendapp://new, agendapp://day/2026-10-12…
  window.__agAction = async (name, arg) => {
    try {
      await closeOverlays();
      sendIntent(name, arg);
    } catch (err) {
      console.error("[AgendApp] action", name, err);
    }
  };
}
