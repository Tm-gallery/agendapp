// Settings › Language & appearance: interface language, theme and haptic feedback. These settings
// belong to the device: they are not replaced by a transfer from another device.
import { LANGUAGES, t } from "../../i18n/index.js";
import { updateState, useAppState } from "../../lib/store.js";
import { isAndroid, setAppLanguage } from "../../platform/android/api.js";
import { PageHeader, Section, Segmented, Select, Toggle } from "../../ui/components.jsx";

const setSettings = (patch) =>
  updateState((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }), { undo: false });

export function AppearancePage({ onBack }) {
  const state = useAppState();
  const setLanguage = (lang) => {
    setSettings({ lang });
    // Widgets, shortcuts and notifications follow too. Android may restart the screen to apply
    // it, so this waits until the setting has been saved.
    if (isAndroid) setTimeout(() => setAppLanguage(lang === "auto" ? "" : lang), 500);
  };
  return (
    <div class="page">
      <PageHeader title={t("settings.appearance")} onBack={onBack} />
      <div class="scroll">
        <Section title={t("appearance.language")}>
          <Select
            id="ap-lang"
            value={state.settings.lang || "auto"}
            onChange={setLanguage}
            options={[{ v: "auto", label: t("appearance.lang.auto") }, ...LANGUAGES]}
          />
          <p class="muted small">{t("appearance.languageHint")}</p>
        </Section>
        <Section title={t("appearance.display")}>
          <div class="blk">
            <div class="cap">{t("appearance.theme")}</div>
            <Segmented
              value={state.settings.theme}
              onChange={(theme) => setSettings({ theme })}
              options={["auto", "light", "dark"].map((v) => ({ v, label: t(`appearance.theme.${v}`) }))}
            />
          </div>
          <Toggle
            id="ap-haptics"
            checked={state.settings.haptics !== false}
            onChange={(haptics) => setSettings({ haptics })}
            label={t("appearance.haptics")}
            hint={t("appearance.hapticsHint")}
          />
        </Section>
      </div>
    </div>
  );
}
