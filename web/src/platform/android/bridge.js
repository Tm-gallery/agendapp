// Material You theme and bridge to the Android shell (window.AndroidBridge).
// Imported first by main.jsx, before the state store: it applies the colours before the first
// paint and, in the Android app, fixes the saved data (events deleted in the phone's calendar)
// before it is loaded. Outside the Android app only the theme part runs.
import { setLanguage, t } from "../../i18n/index.js";
import { initNative } from "./native.js";
import {
  argbFromHex,
  hexFromArgb,
  Hct,
  SchemeTonalSpot,
  MaterialDynamicColors,
  Blend,
  TonalPalette,
} from "@material/material-color-utilities";

const A = window.AndroidBridge || null;
const root = document.documentElement;
const FALLBACK_SEED = 0xff2749d1;

// ---------- Dynamic colour (Material You) ----------
const ROLES = [
  "primary",
  "onPrimary",
  "primaryContainer",
  "onPrimaryContainer",
  "secondary",
  "onSecondary",
  "secondaryContainer",
  "onSecondaryContainer",
  "tertiary",
  "onTertiary",
  "tertiaryContainer",
  "onTertiaryContainer",
  "error",
  "onError",
  "errorContainer",
  "onErrorContainer",
  "surface",
  "onSurface",
  "surfaceVariant",
  "onSurfaceVariant",
  "surfaceDim",
  "surfaceBright",
  "surfaceContainerLowest",
  "surfaceContainerLow",
  "surfaceContainer",
  "surfaceContainerHigh",
  "surfaceContainerHighest",
  "outline",
  "outlineVariant",
  "inverseSurface",
  "inverseOnSurface",
  "inversePrimary",
  "scrim",
  "shadow",
];
// Status colours missing from M3, harmonised with the seed colour.
const CUSTOM = [
  ["ok", "#1e8e4e"],
  ["warn", "#b26a00"],
  ["info", "#1d6fa5"],
];
const kebab = (s) => s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());

function roleVars(seed, dark) {
  const scheme = new SchemeTonalSpot(Hct.fromInt(seed), dark, 0);
  let out = "";
  for (const r of ROLES) {
    const dc = MaterialDynamicColors[r];
    if (dc) out += `--md-${kebab(r)}:${hexFromArgb(dc.getArgb(scheme))};`;
  }
  for (const [name, hex] of CUSTOM) {
    const p = TonalPalette.fromInt(Blend.harmonize(argbFromHex(hex), seed));
    out +=
      `--md-${name}:${hexFromArgb(p.tone(dark ? 80 : 40))};` +
      `--md-on-${name}:${hexFromArgb(p.tone(dark ? 20 : 100))};` +
      `--md-${name}-container:${hexFromArgb(p.tone(dark ? 30 : 90))};` +
      `--md-on-${name}-container:${hexFromArgb(p.tone(dark ? 90 : 10))};`;
  }
  return out;
}

let currentSeed = null;
function applySeed(seed) {
  seed = (seed >>> 0) | 0xff000000;
  if (seed === currentSeed) return;
  currentSeed = seed;
  const light = roleVars(seed, false);
  const dark = roleVars(seed, true);
  const css =
    `:root{${light}}\n` +
    `@media (prefers-color-scheme: dark){:root:not([data-theme='light']){${dark}}}\n` +
    `:root[data-theme='dark']{${dark}}`;
  let el = document.getElementById("m3-dynamic");
  if (!el) {
    el = document.createElement("style");
    el.id = "m3-dynamic";
    (document.head || root).appendChild(el);
  }
  el.textContent = css;
  syncBars();
}

function nativeSeed() {
  try {
    const s = A && A.getSeedColor();
    if (s) return Number(s);
  } catch {}
  return FALLBACK_SEED;
}
window.__m3SetSeed = (s) => applySeed(s || FALLBACK_SEED);

// ---------- System bars: light or dark icons following the app theme ----------
const darkMq = window.matchMedia("(prefers-color-scheme: dark)");
const isDark = () => {
  const t = root.getAttribute("data-theme");
  return t ? t === "dark" : darkMq.matches;
};
let lastDark = null;
function syncBars() {
  const d = isDark();
  if (d === lastDark) return;
  lastDark = d;
  try {
    A && A.setDarkTheme(d);
  } catch {}
}
darkMq.addEventListener?.("change", syncBars);
new MutationObserver(syncBars).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
applySeed(nativeSeed());

// ---------- Insets (system bars, display cutout) ----------
window.__setInsets = (top, bottom) => {
  root.style.setProperty("--sat", top + "px");
  root.style.setProperty("--sab", bottom + "px");
};
try {
  const i = A && JSON.parse(A.getInsets());
  if (i) window.__setInsets(i.top, i.bottom);
} catch {}

// ---------- Files: saving and sharing ----------
const MIME = {
  ics: "text/calendar",
  json: "application/json",
  zip: "application/zip",
  csv: "text/csv",
  txt: "text/plain",
  png: "image/png",
  pdf: "application/pdf",
};
const guessMime = (name) => MIME[(name.split(".").pop() || "").toLowerCase()] || "application/octet-stream";
const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
const mimeOf = (name, type) => (type ? type.split(";")[0] : "") || guessMime(name);

if (A) {
  const nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    const href = this.href || "";
    if (this.hasAttribute("download") && /^(blob|data):/.test(href)) {
      const name = this.getAttribute("download") || "file";
      fetch(href)
        .then((r) => r.blob())
        .then(async (b) => A.saveFile(name, mimeOf(name, b.type), await blobToBase64(b)))
        .catch((e) => console.error("[AgendApp] saveFile", e));
      return;
    }
    return nativeClick.call(this);
  };

  Object.defineProperty(navigator, "canShare", {
    configurable: true,
    value: (data) =>
      !!data && ((Array.isArray(data.files) && data.files.length > 0) || !!data.text || !!data.url),
  });
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: async (data = {}) => {
      if (data.files && data.files.length) {
        const f = data.files[0];
        A.shareFile(f.name, mimeOf(f.name, f.type), await blobToBase64(f));
      } else {
        A.shareText(data.title || "", [data.text, data.url].filter(Boolean).join("\n"));
      }
    },
  });

  // Native clipboard (works even without focus or web permission).
  const clip = navigator.clipboard || {};
  clip.writeText = (text) => {
    A.copyText(String(text));
    return Promise.resolve();
  };
  if (!navigator.clipboard)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: clip });

  // Keeps the screen on during QR transfer (the WebView has no reliable Wake Lock).
  Object.defineProperty(navigator, "wakeLock", {
    configurable: true,
    value: {
      request: async () => {
        A.keepScreenOn(true);
        return {
          released: false,
          type: "screen",
          addEventListener() {},
          removeEventListener() {},
          release: async () => A.keepScreenOn(false),
        };
      },
    },
  });
}

// ---------- Phone calendar (in place of a hosted "Google Calendar" connector) ----------
// The app sends events directly through window.claude.use("mcp") when such a connector exists;
// here the connector is provided locally by CalendarContract (see CalendarSync.kt).
const KEY = "pam-agenda:v1";
const PENDING_KEY = "agendapp:pending-deletes";
const origSet = Storage.prototype.setItem;
const readJSON = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k));
  } catch {
    return null;
  }
};
const writeJSON = (k, v) => {
  try {
    origSet.call(localStorage, k, JSON.stringify(v));
  } catch {}
};
const syncOn = () => {
  try {
    return !!(A && A.getCalSync());
  } catch {
    return false;
  }
};

// The language of messages shown before the app starts.
setLanguage(readJSON(KEY)?.settings?.lang);

// Every save of the app data is relayed to the native modules (calendar, widgets…).
const stateHooks = [];
if (A) {
  Storage.prototype.setItem = function (k, v) {
    origSet.call(this, k, v);
    if (k !== KEY || this !== window.localStorage) return;
    let st;
    try {
      st = JSON.parse(v);
    } catch {
      return;
    }
    for (const h of stateHooks) {
      try {
        h(st, v);
      } catch (e) {
        console.error("[AgendApp]", e);
      }
    }
  };
}

if (A && A.calCall) {
  let seq = 0;
  const calls = new Map();
  window.__calDone = (id, ok, json) => {
    const p = calls.get(id);
    if (!p) return;
    calls.delete(id);
    let data = null;
    try {
      data = JSON.parse(json);
    } catch {}
    if (ok) p.resolve({ payload: data });
    else p.reject(Object.assign(new Error(data?.message || t("android.calendarError")), { code: data?.code }));
  };
  const call = (tool, args = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      calls.set(id, { resolve, reject });
      if (args.allDay && readJSON(KEY)?.settings?.allDayEndExclusive === false && args.endTime) {
        // The Android calendar expects an exclusive end date: undo the "inclusive end" setting.
        const d = new Date(args.endTime.slice(0, 10) + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() + 1);
        args = { ...args, endTime: d.toISOString().slice(0, 10) + "T00:00:00" };
      }
      A.calCall(id, tool, JSON.stringify(args));
    });
  const SERVER = "Google Calendar";
  const mcp = {
    listTools: async () => ({
      servers: [
        {
          server: SERVER,
          tools: ["list_calendars", "create_event", "update_event"].map((name) => ({ name })),
        },
      ],
    }),
    callTool: (server, tool, args) => call(tool, args),
  };
  window.claude = {
    use: async (name) => {
      if (name === "mcp") return mcp;
      throw Object.assign(new Error("unavailable"), { code: "unavailable" });
    },
  };
}

// Events deleted in AgendApp → removed from the calendar (after the undo delay).
const sentMap = (st) => new Map((st?.events || []).filter((e) => e.gcalId).map((e) => [e.id, e.gcalId]));
let pendingDel = new Map(Object.entries(readJSON(PENDING_KEY) || {}));
let delTimer = null;
function flushDeletes() {
  delTimer = null;
  if (!pendingDel.size) return;
  const present = new Set((readJSON(KEY)?.events || []).map((e) => e.id));
  const keys = [...pendingDel].filter(([id]) => !present.has(id)).map(([, k]) => k);
  pendingDel = new Map();
  writeJSON(PENDING_KEY, {});
  if (keys.length && syncOn()) A.calDelete(JSON.stringify(keys));
}

// Events deleted in the calendar → removed from AgendApp, before the app reads its data.
function pruneDeletedInCalendar() {
  if (!A || !A.calMissing || !syncOn()) return 0;
  const st = readJSON(KEY);
  const sent = (st?.events || []).filter((e) => e.gcalId);
  if (!sent.length) return 0;
  let missing;
  try {
    missing = new Set(JSON.parse(A.calMissing(JSON.stringify(sent.map((e) => e.gcalId)))));
  } catch {
    return 0;
  }
  const doomed = sent.filter((e) => missing.has(e.gcalId));
  if (!doomed.length) return 0;
  if (
    doomed.length >= 5 &&
    !window.confirm(t("android.prune.confirm", { n: doomed.length }))
  )
    return 0;
  const now = Date.now();
  const ids = new Set(doomed.map((e) => e.id));
  const gone = { ...(st.gone || {}) };
  ids.forEach((id) => {
    gone[id] = now;
  });
  writeJSON(KEY, { ...st, events: st.events.filter((e) => !ids.has(e.id)), gone, rev: now });
  return ids.size;
}

let pruned = 0;
if (A && A.calMissing) {
  flushDeletes();
  pruned = pruneDeletedInCalendar();
  let sent = sentMap(readJSON(KEY));
  stateHooks.push((st) => {
    const now = sentMap(st);
    if (syncOn()) {
      for (const [id, key] of sent) if (!now.has(id) && st.gone?.[id]) pendingDel.set(id, key);
      if (pendingDel.size) {
        writeJSON(PENDING_KEY, Object.fromEntries(pendingDel));
        clearTimeout(delTimer);
        delTimer = setTimeout(flushDeletes, 8000);
      }
    }
    sent = now;
  });
  window.__calResume = () => {
    if (!syncOn() || document.querySelector("#layers .sheet-wrap, .dlg-wrap")) return;
    const keys = [...sentMap(readJSON(KEY)).values()];
    if (!keys.length) return;
    try {
      if (JSON.parse(A.calMissing(JSON.stringify(keys))).length) location.reload();
    } catch {}
  };
}

/** Short message at the bottom of the screen (falls back to a plain element before the app starts). */
function snackbar(text) {
  if (window.AgendApp?.toast) {
    window.AgendApp.toast(text);
    return;
  }
  let box = document.querySelector(".ag-toasts");
  if (!box) {
    box = document.createElement("div");
    box.className = "toasts ag-toasts";
    document.body.appendChild(box);
  }
  const item = document.createElement("div");
  item.className = "toast";
  item.setAttribute("role", "status");
  item.textContent = text;
  box.appendChild(item);
  setTimeout(() => item.remove(), 4500);
}

// ---------- Back button (predictive back) ----------
// Closes, in order: the dialog, the top sheet, a settings page, then goes back to the first tab.
function backTarget() {
  const dlg = document.querySelector(".dlg-wrap .scrim");
  if (dlg) return dlg;
  const sheets = document.querySelectorAll("#layers .sheet-wrap:not(.out) > .scrim");
  if (sheets.length) return sheets[sheets.length - 1];
  const pageBack = document.querySelector(".tabpane:not([hidden]) .top-l .ibtn");
  if (pageBack) return pageBack;
  const tabs = document.querySelectorAll(".tabbar .tab");
  if (tabs.length && tabs[0].getAttribute("aria-current") !== "page") return tabs[0];
  return null;
}
window.__androidBack = () => {
  const target = backTarget();
  if (target) target.click();
  return !!target;
};
let backEnabled = null,
  backQueued = false;
function syncBack() {
  backQueued = false;
  const e = !!backTarget();
  if (e === backEnabled) return;
  backEnabled = e;
  try {
    A && A.setBackEnabled(e);
  } catch {}
}
const queueBack = () => {
  if (!backQueued) {
    backQueued = true;
    setTimeout(syncBack, 30);
  }
};
document.addEventListener("DOMContentLoaded", () => {
  new MutationObserver(queueBack).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["aria-current", "class"],
  });
  queueBack();
  if (pruned) {
    setTimeout(() => snackbar(t("android.prune.done", { n: pruned })), 600);
  }
});

initNative({ A, KEY, readJSON, stateHooks });
