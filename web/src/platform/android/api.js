// Android-only settings, read from and written to the native shell (window.AndroidBridge, see
// MainActivity.kt). Outside the Android app, `isAndroid` is false and the screens using this
// module are not shown.
import { useEffect, useReducer } from "preact/hooks";

const bridge = typeof window !== "undefined" ? window.AndroidBridge || null : null;

export const isAndroid = !!(bridge && bridge.persist);

const parse = (json, fallback) => {
  try {
    return JSON.parse(json) ?? fallback;
  } catch {
    return fallback;
  }
};

const call = (name, ...args) => {
  try {
    return bridge?.[name]?.(...args);
  } catch (err) {
    console.error("[AgendApp] bridge", name, err);
    return undefined;
  }
};

// The native side calls window.__agSettingsChanged() when something changed on its own
// (backup finished, lock confirmed, folder picked, watch found…).
const listeners = new Set();
export const notifyNativeChange = () => listeners.forEach((listener) => listener());
if (typeof window !== "undefined") {
  window.__agSettingsChanged = notifyNativeChange;
  window.__calSyncState = notifyNativeChange;
}

/** Preact hook: re-renders the component when native settings change. */
export function useNative() {
  const [, rerender] = useReducer((n) => n + 1, 0);
  useEffect(() => {
    listeners.add(rerender);
    return () => listeners.delete(rerender);
  }, []);
}

/** { backup: {...}, lock: {...} } as stored by the native shell. */
export const nativeSettings = () => parse(call("getNativeSettings"), {});

/** Saves part of the native settings: { backup: patch } or { lock: patch }. */
export function setNativeSettings(patch) {
  call("setNativeSettings", JSON.stringify(patch));
  notifyNativeChange();
}

export const backupNow = () => call("backupNow");
export const pickBackupFolder = () => call("pickBackupFolder");
export const openBackupFolder = () => call("openBackupFolder");

/**
 * Turning the lock on or off asks for authentication first; the result arrives later through
 * __agSettingsChanged. Re-rendering now puts the switch back until then.
 */
export function setLockEnabled(on) {
  call("setLockEnabled", on);
  notifyNativeChange();
}

/** Widgets placed on the home screen: [{ id, kind, cfg }]. */
export const listWidgets = () => parse(call("listWidgets"), []);
export const pinWidget = (kind) => call("pinWidget", kind);

export function setWidgetConfig(id, patch) {
  call("setWidgetCfg", id, JSON.stringify(patch));
  notifyNativeChange();
}

/** Connected watches and last sending time: { nodes: [names], at }. */
export const watchInfo = () => parse(call("watchInfo"), {});
export const refreshWatch = () => call("watchRefresh");
export const sendToWatchNow = () => call("watchSyncNow");

/** Whether deletions are mirrored between AgendApp and the phone's calendar. */
export const calendarSyncOn = () => !!call("getCalSync");

export function setCalendarSync(on) {
  call("setCalSync", on);
  notifyNativeChange();
}

/** Per-app language for the native parts (widgets, shortcuts, notifications); "" = system. */
export const setAppLanguage = (code) => call("setAppLanguage", code);
