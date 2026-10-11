// Application shell: three tabs (Calendar, Schedule, Settings), the navigation bar, theme and
// language, and a safety net when rendering fails (the data stays intact).
import { useState, useEffect } from "preact/hooks";
import { Component } from "preact";
import { setLanguage, t } from "./i18n/index.js";
import { getHost, saveFile } from "./lib/host.js";
import { INTENT_TABS, useIntentObserver } from "./lib/intents.js";
import { getState, loadPref, savePref, useAppState } from "./lib/store.js";
import { CalendarTab } from "./screens/CalendarTab.jsx";
import { PlanningTab } from "./screens/PlanningTab.jsx";
import { SettingsTab } from "./screens/SettingsTab.jsx";
import { Icon } from "./ui/Icon.jsx";
import { Overlays } from "./ui/Overlays.jsx";
import { Button } from "./ui/components.jsx";

export function App() {
  const state = useAppState();
  setLanguage(state.settings.lang);
  const [tab, setTabState] = useState(() => loadPref("tab", "cal"));
  // Changing key resets the Settings tab to its home page when the user leaves it.
  const [settingsKey, setSettingsKey] = useState(0);
  const setTab = (next) => {
    if (tab === "set" && next !== "set") {
      setSettingsKey((prev) => prev + 1);
    }
    setTabState(next);
    savePref("tab", next);
  };
  useIntentObserver((name) => setTab(INTENT_TABS[name]));
  useEffect(() => {
    const root = document.documentElement;
    if (state.settings.theme === "light" || state.settings.theme === "dark") {
      root.setAttribute("data-theme", state.settings.theme);
    } else {
      root.removeAttribute("data-theme");
    }
  }, [state.settings.theme]);
  const pending = state.events.filter((ev) => ev.status !== "exported").length;
  return (
    <>
      <main class="tabpane" hidden={tab !== "cal"}>
        <CalendarTab goSettings={() => setTab("set")} />
      </main>
      <main class="tabpane" hidden={tab !== "plan"}>
        <PlanningTab />
      </main>
      <main class="tabpane" hidden={tab !== "set"}>
        <SettingsTab key={settingsKey} />
      </main>
      <nav class="tabbar" aria-label={t("nav.label")}>
        {[
          ["cal", "calendar", t("nav.calendar")],
          ["plan", "list", t("nav.schedule")],
          ["set", "gear", t("nav.settings")],
        ].map(([key, icon, label]) => (
          <button
            type="button"
            class="tab"
            aria-current={tab === key ? "page" : undefined}
            onClick={() => setTab(key)}
            key={key}
          >
            <Icon n={icon} size={23} />
            <span>{label}</span>
            {key === "plan" && pending > 0 && <span class="cnt">{pending > 99 ? "99+" : pending}</span>}
          </button>
        ))}
      </nav>
      <Overlays />
    </>
  );
}

/** Shows a recovery screen instead of a blank page if a screen throws while rendering. */
export const ErrorBoundary = class extends Component {
  state = { err: null };
  componentDidCatch(err) {
    this.setState({ err });
    console.error(err);
  }
  render() {
    return this.state.err ? (
      <div class="crash">
        <h2>{t("crash.title")}</h2>
        <p>{t("crash.text")}</p>
        <code>{String(this.state.err?.message || this.state.err)}</code>
        <div class="stack">
          <Button kind="primary" block={true} onClick={() => this.setState({ err: null })}>
            {t("crash.retry")}
          </Button>
          <Button
            block={true}
            icon="download"
            onClick={async () =>
              saveFile(await getHost(), {
                filename: "agendapp-backup.json",
                data: JSON.stringify(getState()),
                mime: "application/json",
              })
            }
          >
            {t("crash.save")}
          </Button>
        </div>
      </div>
    ) : (
      this.props.children
    );
  }
};
