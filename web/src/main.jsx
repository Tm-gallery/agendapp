// Entry point. Import order matters: the Android bridge (and the theme) runs before the state
// store (lib/store.js) reads the saved data.
import "./platform/android/bridge.js";
import { render } from "preact";
import { App, ErrorBoundary } from "./App.jsx";
import { setLanguage } from "./i18n/index.js";
import { startCloudSync } from "./lib/cloud.js";
import { installHaptics } from "./lib/haptics.js";
import { getState, updateState } from "./lib/store.js";
import { confirmDialog, toast } from "./ui/Overlays.jsx";

// Debugging and automation hook (used by the screenshot script).
window.AgendApp = { getState, updateState, toast, confirmDialog };

setLanguage(getState().settings.lang);
installHaptics();

render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
  document.getElementById("app"),
);

startCloudSync().catch(() => {});
