// Settings › Fields: what is filled in for each event (a person, several people, text, a time).
import { useState } from "preact/hooks";
import { t } from "../../i18n/index.js";
import { moveById, pruneReferences, removeById, upsertById } from "../../lib/events.js";
import { newId, slugify } from "../../lib/model.js";
import { undo, updateState, useAppState } from "../../lib/store.js";
import { Icon } from "../../ui/Icon.jsx";
import { confirmDialog, toast } from "../../ui/Overlays.jsx";
import { Sheet } from "../../ui/Sheet.jsx";
import {
  Button,
  EmptyState,
  Field,
  ListItem,
  PageHeader,
  Segmented,
  TextInput,
  Toggle,
} from "../../ui/components.jsx";

const FIELD_KINDS = ["person", "people", "text", "time"];

const kindOptions = () =>
  FIELD_KINDS.map((v) => ({ v, label: t(`fields.kind.${v}`), sub: t(`fields.kind.${v}Sub`) }));

function FieldEditor({ field, onClose }) {
  const state = useAppState();
  const [draft, setDraft] = useState(field);
  const [keyEdited, setKeyEdited] = useState(false);
  const isNew = !state.fields.some((f) => f.id === field.id);
  const setLabel = (label) =>
    setDraft((prev) => ({
      ...prev,
      label,
      key: keyEdited || !isNew ? prev.key : slugify(label),
    }));
  return (
    <Sheet
      onClose={onClose}
      title={t(isNew ? "fields.new" : "fields.edit")}
      footer={
        <div class="row gap-s">
          {!isNew && (
            <Button
              kind="danger"
              icon="trash"
              aria-label={t("common.delete")}
              onClick={async () => {
                if (
                  await confirmDialog({
                    title: t("fields.deleteTitle"),
                    text: t("fields.deleteText"),
                    confirmLabel: t("common.delete"),
                    danger: true,
                  })
                ) {
                  updateState(
                    (prev) => pruneReferences({ ...prev, fields: removeById(prev.fields, draft.id) }),
                    { label: t("fields.deleted") },
                  );
                  toast(t("fields.deleted"), { action: { label: t("common.undo"), run: undo } });
                  onClose();
                }
              }}
            />
          )}
          <Button
            kind="primary"
            block={true}
            onClick={() => {
              if (!draft.label.trim()) {
                return toast(t("fields.needName"));
              }
              let key = slugify(draft.key || draft.label);
              const taken = (candidate) =>
                state.fields.some((other) => other.key === candidate && other.id !== draft.id) ||
                ["type", "typeCode", "slot", "slotCode", "date", "note"].includes(candidate);
              let n = 2;
              const base = key;
              while (taken(key)) {
                key = `${base}_${n++}`;
              }
              updateState(
                (prev) => ({
                  ...prev,
                  fields: upsertById(prev.fields, { ...draft, label: draft.label.trim(), key }),
                }),
                { label: t("undo.field") },
              );
              onClose();
            }}
          >
            {t("common.save")}
          </Button>
        </div>
      }
    >
      <Field label={t("common.name")} for="fd-label">
        <TextInput id="fd-label" value={draft.label} onInput={setLabel} placeholder={t("fields.namePlaceholder")} />
      </Field>
      <div class="blk">
        <div class="cap">{t("fields.content")}</div>
        <Segmented value={draft.kind} onChange={(value) => setDraft({ ...draft, kind: value })} options={kindOptions()} />
        <p class="muted small">
          {t(draft.kind === "time" ? "fields.timeHint" : draft.kind === "text" ? "fields.textHint" : "fields.peopleHint")}
        </p>
      </div>
      <Toggle
        id="fd-sticky"
        checked={draft.sticky}
        onChange={(value) => setDraft({ ...draft, sticky: value })}
        label={t("fields.sticky")}
        hint={t("fields.stickyHint")}
      />
      <Field label={t("fields.key")} for="fd-key" hint={t("fields.keyHint", { key: `{${draft.key || "…"}}` })}>
        <TextInput
          id="fd-key"
          value={draft.key}
          onInput={(value) => {
            setKeyEdited(true);
            setDraft({ ...draft, key: value.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase() });
          }}
        />
      </Field>
    </Sheet>
  );
}

export function FieldsPage({ onBack }) {
  const state = useAppState();
  const [editing, setEditing] = useState(null);
  const kindLabel = (kind) => t(`fields.kind.${kind}`);
  return (
    <div class="page">
      <PageHeader
        title={t("settings.fields")}
        onBack={onBack}
        right={
          <Button
            small={true}
            kind="soft"
            icon="plus"
            onClick={() => setEditing({ id: newId("f"), key: "", label: "", kind: "person", sticky: false })}
          >
            {t("common.add")}
          </Button>
        }
      />
      <div class="scroll">
        <p class="lead">{t("fields.lead")}</p>
        {state.fields.length === 0 && (
          <EmptyState icon="tag" title={t("fields.empty")} text={t("fields.emptyHint")} />
        )}
        <div class="stack">
          {state.fields.map((field, index) => (
            <ListItem
              title={field.label}
              sub={`${kindLabel(field.kind)}${field.sticky ? ` · ${t("fields.stickyShort")}` : ""} · {${field.key}}`}
              onClick={() => setEditing(field)}
              right={
                <span class="row" onClick={(ev) => ev.stopPropagation()}>
                  <button
                    type="button"
                    class="ibtn sm"
                    aria-label={t("common.moveUp")}
                    disabled={index === 0}
                    onClick={() =>
                      updateState((prev) => ({ ...prev, fields: moveById(prev.fields, field.id, -1) }), {
                        undo: false,
                      })
                    }
                  >
                    <Icon n="arrowUp" size={16} />
                  </button>
                  <button
                    type="button"
                    class="ibtn sm"
                    aria-label={t("common.moveDown")}
                    disabled={index === state.fields.length - 1}
                    onClick={() =>
                      updateState((prev) => ({ ...prev, fields: moveById(prev.fields, field.id, 1) }), {
                        undo: false,
                      })
                    }
                  >
                    <Icon n="arrowDown" size={16} />
                  </button>
                </span>
              }
              key={field.id}
            />
          ))}
        </div>
      </div>
      {editing && <FieldEditor field={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
