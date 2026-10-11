// Settings › Calendar & export: how events are written to calendars (name, time zone, all-day
// events) and, in the Android app, whether deletions are mirrored with the phone's calendar.
import { t } from "../../i18n/index.js";
import { TIMEZONES } from "../../lib/model.js";
import { updateState, useAppState } from "../../lib/store.js";
import { calendarSyncOn, isAndroid, setCalendarSync, useNative } from "../../platform/android/api.js";
import { Field, PageHeader, Section, Select, TextInput, Toggle } from "../../ui/components.jsx";

const setSettings = (patch) =>
  updateState((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }), { undo: false });

export function CalendarPage({ onBack }) {
  const state = useAppState();
  useNative();
  return (
    <div class="page">
      <PageHeader title={t("settings.calendar")} onBack={onBack} />
      <div class="scroll">
        <p class="lead">{t("calendar.lead")}</p>
        <Section title={t("calendar.events")}>
          <Field label={t("calendar.name")} for="cp-name" hint={t("calendar.nameHint")}>
            <TextInput
              id="cp-name"
              value={state.settings.calName}
              onInput={(calName) => setSettings({ calName })}
              onBlur={() => !state.settings.calName.trim() && setSettings({ calName: "AgendApp" })}
            />
          </Field>
          <Field label={t("calendar.timeZone")} for="cp-tz" hint={t("calendar.timeZoneHint")}>
            <Select
              id="cp-tz"
              value={state.settings.tz}
              onChange={(tz) => setSettings({ tz })}
              options={TIMEZONES.map((zone) => ({ v: zone.id, label: zone.label }))}
            />
          </Field>
          {/* The phone's calendar always gets exact all-day ends: this only matters on the web. */}
          {!isAndroid && (
            <Toggle
              id="cp-end"
              checked={state.settings.allDayEndExclusive}
              onChange={(allDayEndExclusive) => setSettings({ allDayEndExclusive })}
              label={t("calendar.allDayEnd")}
              hint={t("calendar.allDayEndHint")}
            />
          )}
        </Section>
        {isAndroid && (
          <Section title={t("calendar.phone")}>
            <Toggle
              id="cp-sync"
              checked={calendarSyncOn()}
              onChange={setCalendarSync}
              label={t("calendar.syncDeletes")}
              hint={t("calendar.syncDeletesHint")}
            />
          </Section>
        )}
      </div>
    </div>
  );
}
