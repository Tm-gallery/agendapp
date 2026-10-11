// Settings › Backup & restore: backup files (save and restore), automatic backup in the Android
// app, the built-in example template, and erasing data.
import { useRef } from "preact/hooks";
import { locale, t } from "../../i18n/index.js";
import { syncCloudNow, useCloudState } from "../../lib/cloud.js";
import { deleteEvents } from "../../lib/events.js";
import { exampleState } from "../../lib/example.js";
import { getHost, saveFile } from "../../lib/host.js";
import { deviceSettings, emptyState } from "../../lib/model.js";
import {
  importState,
  isStorageOk,
  isTemplateHidden,
  setTemplateHidden,
  undo,
  updateState,
  useAppState,
} from "../../lib/store.js";
import { isAndroid, useNative } from "../../platform/android/api.js";
import { backupSummary } from "../../platform/android/AndroidSheets.jsx";
import { Icon } from "../../ui/Icon.jsx";
import { confirmDialog, toast } from "../../ui/Overlays.jsx";
import { Button, ListItem, PageHeader, Section, Toggle } from "../../ui/components.jsx";

/** Online sync status, only shown when the page is hosted by Claude with storage. */
function CloudSyncStatus() {
  const cloud = useCloudState();
  if (cloud.status === "off" || cloud.status === "unavailable") {
    return null;
  }
  const time = cloud.last
    ? new Date(cloud.last).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })
    : "";
  return (
    <div class={`callout ${cloud.status === "ok" ? "ok" : cloud.status === "error" ? "danger" : ""}`}>
      <Icon n={cloud.status === "ok" ? "check" : "info"} size={18} />
      <div>
        <b>{t(`cloud.${cloud.status}`)}</b>
        <p>
          {cloud.status === "ok"
            ? t(time ? "cloud.okTextAt" : "cloud.okText", { time })
            : cloud.status === "error"
              ? t("cloud.errorText", { error: cloud.error })
              : t("cloud.connectingText")}
        </p>
        {cloud.status !== "connecting" && (
          <div class="row">
            <Button small={true} kind="soft" icon="repeat" onClick={() => syncCloudNow()}>
              {t("cloud.syncNow")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function DataPage({ onBack, openSheet }) {
  const state = useAppState();
  useNative();
  const fileRef = useRef(null);
  const exportJson = async (full) => {
    const data = full ? state : { ...state, events: [], usage: {} };
    try {
      const result = await saveFile(await getHost(), {
        filename: full ? "agendapp-backup.json" : "agendapp-configuration.json",
        data: JSON.stringify(data, null, 1),
        mime: "application/json",
      });
      if (result === "saved") {
        toast(t("data.saved"));
      }
    } catch (err) {
      toast(t("common.failed", { error: err?.message || err?.code }), { tone: "danger" });
    }
  };
  const importJson = async (file) => {
    if (!file) {
      return;
    }
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data != "object" || (!data.types && !data.slots && !data.events)) {
        throw new Error(t("data.unknownFile"));
      }
      const confirmed = await confirmDialog({
        title: t("data.replaceTitle"),
        text: t("data.replaceText", {
          types: data.types?.length || 0,
          slots: data.slots?.length || 0,
          events: data.events?.length || 0,
        }),
        confirmLabel: t("data.replace"),
        danger: true,
      });
      if (!confirmed) {
        return;
      }
      importState(
        { ...data, settings: { ...(data.settings || {}), ...deviceSettings(state.settings) } },
        { label: t("undo.import") },
      );
      toast(t("data.imported"), { action: { label: t("common.undo"), run: undo } });
    } catch (err) {
      toast(t("data.importFailed", { error: err.message }), { tone: "danger" });
    }
  };
  const loadTemplate = async () => {
    const hasData = state.types.length || state.events.length;
    if (
      hasData &&
      !(await confirmDialog({
        title: t("data.templateTitle"),
        text: t("data.templateText"),
        confirmLabel: t("data.replace"),
        danger: true,
      }))
    ) {
      return;
    }
    const template = exampleState();
    importState({ ...template, settings: { ...template.settings, ...state.settings } }, { label: t("undo.template") });
    toast(t("data.templateLoaded"), { action: { label: t("common.undo"), run: undo } });
  };
  const templateShown = !isTemplateHidden();
  return (
    <div class="page">
      <PageHeader title={t("settings.data")} onBack={onBack} />
      <div class="scroll">
        {!isStorageOk() && (
          <div class="callout warn">
            <Icon n="alert" size={18} />
            <div>
              <b>{t("data.storageTitle")}</b>
              <p>{t("data.storageText")}</p>
            </div>
          </div>
        )}
        <CloudSyncStatus />
        <Section title={t("data.file")} hint={t(isAndroid ? "data.fileHintAndroid" : "data.fileHint")}>
          <div class="stack">
            <Button block={true} icon="download" onClick={() => exportJson(true)}>
              {t("data.saveAll")}
            </Button>
            <Button block={true} icon="download" onClick={() => exportJson(false)}>
              {t("data.saveConfig")}
            </Button>
            <Button block={true} icon="upload" onClick={() => fileRef.current?.click()}>
              {t("data.restore")}
            </Button>
            <input
              ref={fileRef}
              id="import-file"
              type="file"
              accept=".json,application/json,text/plain"
              hidden={true}
              onChange={(ev) => {
                importJson(ev.currentTarget.files?.[0]);
                ev.currentTarget.value = "";
              }}
            />
          </div>
        </Section>
        {isAndroid && (
          <Section title={t("android.backup.title")}>
            <ListItem
              left={
                <span class="li-ico">
                  <Icon n="backup" size={20} />
                </span>
              }
              title={t("android.backup.title")}
              sub={backupSummary()}
              onClick={() => openSheet("backup")}
            />
          </Section>
        )}
        <Section title={t("data.template")}>
          <Toggle
            id="dt-template"
            checked={templateShown}
            onChange={(on) => setTemplateHidden(!on)}
            label={t("data.templateToggle")}
            hint={t("data.templateToggleHint")}
          />
          {templateShown && (
            <Button block={true} icon="wand" onClick={loadTemplate}>
              {t("data.loadTemplate")}
            </Button>
          )}
        </Section>
        <Section title={t("data.danger")}>
          <div class="stack">
            <Button
              kind="danger"
              block={true}
              icon="trash"
              disabled={!state.events.length}
              onClick={async () => {
                if (
                  await confirmDialog({
                    title: t("data.clearEventsTitle"),
                    text: t("data.clearEventsText"),
                    confirmLabel: t("data.clear"),
                    danger: true,
                  })
                ) {
                  updateState(
                    (prev) =>
                      deleteEvents(
                        prev,
                        prev.events.map((ev) => ev.id),
                      ),
                    { label: t("data.eventsCleared") },
                  );
                  toast(t("data.eventsCleared"), { action: { label: t("common.undo"), run: undo } });
                }
              }}
            >
              {t("data.clearEvents")}
            </Button>
            <Button
              kind="danger"
              block={true}
              icon="trash"
              onClick={async () => {
                if (
                  await confirmDialog({
                    title: t("data.resetTitle"),
                    text: t("data.resetText"),
                    confirmLabel: t("data.reset"),
                    danger: true,
                  })
                ) {
                  importState({ ...emptyState(), settings: state.settings }, { label: t("data.resetDone") });
                  toast(t("data.resetDone"), { action: { label: t("common.undo"), run: undo } });
                }
              }}
            >
              {t("data.reset")}
            </Button>
          </div>
        </Section>
      </div>
    </div>
  );
}
