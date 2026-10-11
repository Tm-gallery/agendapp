// Settings tab: home screen and navigation to each settings page. Grouped by purpose:
//   Your schedule      what repeats: slots, fields, event types, rules, people
//   Hours & export     how hours are counted and how events reach a calendar
//   Your data          backups (manual and automatic), transfer between devices, reset
//   App                language and appearance, plus Android-only features (lock, widgets, watch)
import { useState } from "preact/hooks";
import { LANGUAGES, t } from "../i18n/index.js";
import { useIntent } from "../lib/intents.js";
import { useAppState } from "../lib/store.js";
import { isAndroid, useNative } from "../platform/android/api.js";
import {
  BackupSheet,
  LockSheet,
  WatchSheet,
  WidgetConfigSheet,
  WidgetsSheet,
  backupSummary,
  lockSummary,
  watchSummary,
  widgetsSummary,
} from "../platform/android/AndroidSheets.jsx";
import { AppearancePage } from "./settings/AppearancePage.jsx";
import { CalendarPage } from "./settings/CalendarPage.jsx";
import { DataPage } from "./settings/DataPage.jsx";
import { FieldsPage } from "./settings/FieldsPage.jsx";
import { NamesPage } from "./settings/NamesPage.jsx";
import { RulesPage } from "./settings/RulesPage.jsx";
import { SlotsPage } from "./settings/SlotsPage.jsx";
import { StatsRulesSheet } from "./settings/StatsRulesSheet.jsx";
import { TransferPage } from "./settings/TransferPage.jsx";
import { TypesPage } from "./settings/TypesPage.jsx";
import { Icon } from "../ui/Icon.jsx";
import { ListItem, PageHeader, Section } from "../ui/components.jsx";

const PAGES = {
  slots: SlotsPage,
  fields: FieldsPage,
  types: TypesPage,
  rules: RulesPage,
  people: NamesPage,
  calendar: CalendarPage,
  data: DataPage,
  transfer: TransferPage,
  appearance: AppearancePage,
};

const Row = ({ icon, title, sub, onClick, big, hint }) => (
  <ListItem
    class={big ? "big" : ""}
    left={
      <span class="li-ico">
        <Icon n={icon} size={20} />
      </span>
    }
    title={title}
    sub={sub}
    right={hint && <small class="muted">{hint}</small>}
    onClick={onClick}
  />
);

export function SettingsTab() {
  const state = useAppState();
  useNative();
  const [page, setPage] = useState("home");
  const [sheet, setSheet] = useState(null);
  const [widgetId, setWidgetId] = useState(null);
  const back = () => setPage("home");

  useIntent(["settings", "backup", "widget"], (name, arg) => {
    setSheet(null);
    if (name === "settings") {
      setPage("home");
    } else if (name === "backup") {
      setPage("data");
      setSheet("backup");
    } else if (name === "widget") {
      setPage("home");
      setWidgetId(Number(arg));
    }
  });

  const sheets = (
    <>
      {sheet === "stats" && <StatsRulesSheet onClose={() => setSheet(null)} />}
      {sheet === "backup" && <BackupSheet onClose={() => setSheet(null)} />}
      {sheet === "lock" && <LockSheet onClose={() => setSheet(null)} />}
      {sheet === "widgets" && <WidgetsSheet onClose={() => setSheet(null)} onConfigure={setWidgetId} />}
      {sheet === "watch" && <WatchSheet onClose={() => setSheet(null)} />}
      {widgetId != null && <WidgetConfigSheet id={widgetId} onClose={() => setWidgetId(null)} />}
    </>
  );

  const Page = PAGES[page];
  if (Page) {
    return (
      <>
        <Page onBack={back} Back={PageHeader} openSheet={setSheet} />
        {sheets}
      </>
    );
  }

  const peopleCount = Object.keys(state.people).length;
  const language = LANGUAGES.find((lang) => lang.v === state.settings.lang)?.label || t("appearance.lang.auto");
  return (
    <div class="page">
      <header class="top">
        <div class="top-t">
          <h1>{t("nav.settings")}</h1>
        </div>
      </header>
      <div class="scroll">
        <p class="lead">{t("settings.lead")}</p>
        <Section title={t("settings.section.schedule")}>
          <div class="stack">
            <Row
              big
              icon="clock"
              title={t("settings.slots")}
              sub={`${t("settings.slotCount", { n: state.slots.length })} · ${t("settings.groupCount", { n: state.groups.length })}`}
              hint={t("settings.slotsHint")}
              onClick={() => setPage("slots")}
            />
            <Row
              big
              icon="tag"
              title={t("settings.fields")}
              sub={t("settings.fieldCount", { n: state.fields.length })}
              hint={t("settings.fieldsHint")}
              onClick={() => setPage("fields")}
            />
            <Row
              big
              icon="calendar"
              title={t("settings.types")}
              sub={t("settings.typeCount", { n: state.types.length })}
              hint={t("settings.typesHint")}
              onClick={() => setPage("types")}
            />
            <Row
              big
              icon="bolt"
              title={t("settings.rules")}
              sub={t("settings.ruleCount", { n: state.rules.length })}
              hint={t("settings.rulesHint")}
              onClick={() => setPage("rules")}
            />
            <Row
              big
              icon="users"
              title={t("settings.people")}
              sub={t("settings.peopleCount", { n: peopleCount })}
              hint={t("settings.peopleHint")}
              onClick={() => setPage("people")}
            />
          </div>
        </Section>
        <Section title={t("settings.section.export")}>
          <div class="stack">
            <Row
              icon="chart"
              title={t("stats.title")}
              sub={t("settings.statsSub")}
              onClick={() => setSheet("stats")}
            />
            <Row
              icon="upload"
              title={t("settings.calendar")}
              sub={t("settings.calendarSub", { name: state.settings.calName || "AgendApp" })}
              onClick={() => setPage("calendar")}
            />
          </div>
        </Section>
        <Section title={t("settings.section.data")}>
          <div class="stack">
            <Row
              icon="download"
              title={t("settings.data")}
              sub={isAndroid ? t("settings.dataSubAndroid", { auto: backupSummary() }) : t("settings.dataSub")}
              onClick={() => setPage("data")}
            />
            <Row
              icon="qr"
              title={t("settings.transfer")}
              sub={t("settings.transferSub")}
              onClick={() => setPage("transfer")}
            />
          </div>
        </Section>
        <Section title={t("settings.section.app")}>
          <div class="stack">
            <Row
              icon="language"
              title={t("settings.appearance")}
              sub={`${language} · ${t(`appearance.theme.${state.settings.theme || "auto"}`)}`}
              onClick={() => setPage("appearance")}
            />
            {isAndroid && (
              <>
                <Row icon="lock" title={t("android.lock.title")} sub={lockSummary()} onClick={() => setSheet("lock")} />
                <Row
                  icon="widgets"
                  title={t("android.widgets.title")}
                  sub={widgetsSummary()}
                  onClick={() => setSheet("widgets")}
                />
                <Row icon="watch" title={t("android.watch.title")} sub={watchSummary()} onClick={() => setSheet("watch")} />
              </>
            )}
          </div>
        </Section>
      </div>
      {sheets}
    </div>
  );
}
