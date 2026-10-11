// State store: the whole app state (configuration + events), persisted in the browser's
// localStorage (or the Android WebView's) under STORAGE_KEY. Every change goes through
// updateState(), which keeps an undo history.
import { useEffect, useReducer } from "preact/hooks";
import { emptyState, normalizeState } from "./model.js";

// Historical key names, kept so that existing data keeps loading.
const STORAGE_KEY = "pam-agenda:v1";
const PREF_PREFIX = "pam-agenda:";
const TEMPLATE_KEY = "agendapp:hide-template";

const UNDO_LIMIT = 40;

// In-memory fallback when storage is unavailable (private browsing, blocked local file…).
const memoryFallback = {};

const storage = {
  get(key) {
    try {
      return window.localStorage.getItem(key) ?? memoryFallback[key] ?? null;
    } catch {
      return memoryFallback[key] ?? null;
    }
  },
  set(key, value) {
    memoryFallback[key] = value;
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
};

function loadState() {
  try {
    const raw = storage.get(STORAGE_KEY);
    if (raw) {
      return normalizeState(JSON.parse(raw));
    }
  } catch {}
  return emptyState();
}

let currentState = loadState();
let saveTimer = null;
let storageOk = true;
const listeners = new Set();
const undoStack = [];

/** Called after each save (online sync, see cloud.js). */
const saveHook = { push: null };

export const getState = () => currentState;

export const canUndo = () => undoStack.length > 0;

export const isStorageOk = () => storageOk;

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  storageOk = storage.set(STORAGE_KEY, JSON.stringify(currentState));
  saveHook.push?.(currentState);
}

// Changes made in quick succession are written once.
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 200);
}

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

/**
 * Applies `change(state) → new state`. Nothing happens if `change` returns the same state or
 * nothing. `label` describes the action for the "Undone: …" message.
 */
export function updateState(change, { undo: withUndo = true, label = "" } = {}) {
  const next = change(currentState);
  if (!next || next === currentState) {
    return;
  }
  if (withUndo) {
    undoStack.push({ s: currentState, label });
    if (undoStack.length > UNDO_LIMIT) {
      undoStack.shift();
    }
  }
  currentState = { ...next, rev: Date.now() };
  scheduleSave();
  notifyListeners();
}

/** Restores the previous state. Returns the label of the undone action, or null. */
export function undo() {
  const entry = undoStack.pop();
  if (!entry) {
    return null;
  }
  currentState = { ...entry.s, rev: Date.now() };
  scheduleSave();
  notifyListeners();
  return entry.label;
}

/** Replaces the whole state without history (online sync). */
export function replaceState(state) {
  currentState = state;
  undoStack.length = 0;
  clearTimeout(saveTimer);
  storageOk = storage.set(STORAGE_KEY, JSON.stringify(currentState));
  notifyListeners();
}

export const rawStorage = { get: (key) => storage.get(key), set: (key, value) => storage.set(key, value) };

/** Replaces the data with a backup or a template (undoable). */
export function importState(state, { undo: withUndo = true, label = "" } = {}) {
  updateState(() => normalizeState(state), { undo: withUndo, label });
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Preact hook: returns the state and re-renders the component on every change. */
export function useAppState() {
  const [, rerender] = useReducer((n) => n + 1, 0);
  useEffect(() => subscribe(rerender), []);
  return currentState;
}

// Saves immediately if the page closes during the grouping delay.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => saveTimer && saveNow());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && saveTimer) saveNow();
  });
}

/** View preferences (open tab, filters…), specific to this device and not backed up. */
export function loadPref(name, fallback = null) {
  const raw = storage.get(PREF_PREFIX + name);
  if (raw == null) {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function savePref(name, value) {
  storage.set(PREF_PREFIX + name, JSON.stringify(value));
}

/** Whether the built-in example template is offered (Settings › Backup & restore). */
export const isTemplateHidden = () => storage.get(TEMPLATE_KEY) === "1";

export function setTemplateHidden(hidden) {
  storage.set(TEMPLATE_KEY, hidden ? "1" : "0");
  notifyListeners();
}
