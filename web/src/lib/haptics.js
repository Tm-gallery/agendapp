// Haptic feedback: a short vibration on each tap (can be turned off in the settings).
import { getState } from "./store.js";

export function haptic(ms = 8) {
  try {
    if (getState().settings.haptics !== false) {
      navigator.vibrate?.(ms);
    }
  } catch {}
}

const HAPTIC_TARGETS =
  'button, a[href], [role="button"], [role="radio"], [role="tab"], summary, label.toggle, .cbx, .cell';

let lastHapticAt = 0;

/** Vibrates on every click on an interactive element (stronger for main actions). */
export function installHaptics() {
  if (typeof document === "undefined" || installHaptics.done) {
    return;
  }
  installHaptics.done = true;
  document.addEventListener(
    "click",
    (ev) => {
      const target = ev.target instanceof Element ? ev.target.closest(HAPTIC_TARGETS) : null;
      if (!target || target.disabled || target.getAttribute("aria-disabled") === "true") {
        return;
      }
      const now = Date.now();
      if (now - lastHapticAt < 40) {
        return;
      }
      lastHapticAt = now;
      const ms = target.classList.contains("btn-primary")
        ? 12
        : target.classList.contains("btn-danger")
          ? 14
          : 7;
      haptic(ms);
    },
    true,
  );
}
