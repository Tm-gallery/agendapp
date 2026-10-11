// User interface translations. English is the reference language; every key must exist in en.js,
// other catalogs may omit keys (they fall back to English).
//
//   t("plan.title")                     → "Schedule"
//   t("common.events", { n: 3 })        → "3 events"      (catalog entry is a function)
//   t("cal.addOn", { day: 12 })         → "Add on the 12th" ({name} placeholders)
//
// The language is chosen in Settings › Language & appearance ("auto" follows the device).
import en from "./en.js";
import fr from "./fr.js";

const CATALOGS = { en, fr };

/** Languages offered in the settings, in their own language. */
export const LANGUAGES = [
  { v: "en", label: "English" },
  { v: "fr", label: "Français" },
];

let current = "en";

/** Resolves a preference ("auto", "en", "fr"…) to a supported language code. */
export function resolveLanguage(pref) {
  if (pref && pref !== "auto" && CATALOGS[pref]) {
    return pref;
  }
  const preferred = typeof navigator !== "undefined" ? navigator.languages || [navigator.language] : [];
  for (const tag of preferred) {
    const code = String(tag || "").slice(0, 2).toLowerCase();
    if (CATALOGS[code]) {
      return code;
    }
  }
  return "en";
}

/** Sets the current language; returns the resolved code. */
export function setLanguage(pref) {
  current = resolveLanguage(pref);
  if (typeof document !== "undefined") {
    document.documentElement.lang = current;
  }
  return current;
}

export const language = () => current;

/** BCP 47 locale for Intl APIs and string sorting. */
export const locale = () => (current === "fr" ? "fr-FR" : "en-GB");

function lookup(key) {
  return CATALOGS[current][key] ?? CATALOGS.en[key];
}

/** Translated string for `key`, with `{name}` placeholders filled from `vars`. */
export function t(key, vars = {}) {
  const entry = lookup(key);
  if (entry == null) {
    return key;
  }
  if (typeof entry === "function") {
    return entry(vars);
  }
  return String(entry).replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

/** Translated list (month names, weekday names…). */
export function tList(key) {
  const entry = lookup(key);
  return Array.isArray(entry) ? entry : [];
}

/** Locale-aware comparison for sorting names. */
export const compareText = (a, b) => String(a).localeCompare(String(b), locale());
