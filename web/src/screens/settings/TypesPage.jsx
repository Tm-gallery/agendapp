// Settings › Event types: the template of each kind of event (slots, fields, colour, title,
// reminders). This is where everything that repeats is described.
import { useState } from "preact/hooks";
import { t } from "../../i18n/index.js";
import { formatTime, todayIso } from "../../lib/dates.js";
import { moveById, pruneReferences, removeById, upsertById } from "../../lib/events.js";
import { COLORS, colorById, endsNextDay, isPeopleField, newId } from "../../lib/model.js";
import { undo, updateState, useAppState } from "../../lib/store.js";
import { defaultTitleTemplate, eventTitle, templateVariables } from "../../lib/templates.js";
import { Icon } from "../../ui/Icon.jsx";
import { confirmDialog, toast } from "../../ui/Overlays.jsx";
import { Sheet } from "../../ui/Sheet.jsx";
import {
  Badge,
  Button,
  ChipPicker,
  EmptyState,
  Field,
  ListItem,
  Section,
  Segmented,
  Stepper,
  TextInput,
  Toggle,
  contrastText,
} from "../../ui/components.jsx";

const alarmOptions = () => [
  { v: 15, label: t("common.minutes", { n: 15 }) },
  { v: 30, label: t("common.minutes", { n: 30 }) },
  { v: 60, label: t("common.hours", { n: 1 }) },
  { v: 120, label: t("common.hours", { n: 2 }) },
  { v: 180, label: t("common.hours", { n: 3 }) },
  { v: 720, label: t("common.hours", { n: 12 }) },
  { v: 1440, label: t("common.days", { n: 1 }) },
];

const newType = (state) => ({
  id: newId("t"),
  name: "",
  code: "",
  color: COLORS[state.types.length % COLORS.length].id,
  kind: "slot",
  slotIds: state.slots.map((slot) => slot.id),
  fields: [],
  titleTpl: defaultTitleTemplate(state),
  descTpl: "",
  location: "",
  alarms: [],
  days: 1,
  snapWeek: false,
  times: {},
});

function TypeEditor({ type, onClose }) {
  const state = useAppState();
  const [draft, setDraft] = useState(type);
  const [customHours, setCustomHours] = useState(Object.keys(type.times || {}).length > 0);
  const isNew = !state.types.some((t) => t.id === type.id);
  const allowedSlots = state.slots.filter((slot) => draft.slotIds.includes(slot.id));
  const patch = (changes) => setDraft((prev) => ({ ...prev, ...changes }));
  const fieldConfig = (fieldId) => draft.fields.find((field) => field.fieldId === fieldId);
  const toggleField = (fieldId) =>
    patch({
      fields: fieldConfig(fieldId)
        ? draft.fields.filter((field) => field.fieldId !== fieldId)
        : [...draft.fields, { fieldId, slotIds: null, required: false }],
    });
  const patchField = (fieldId, changes) =>
    patch({
      fields: draft.fields.map((field) => (field.fieldId === fieldId ? { ...field, ...changes } : field)),
    });
  const moveField = (fieldId, delta) => {
    const from = draft.fields.findIndex((field) => field.fieldId === fieldId);
    const to = from + delta;
    if (to < 0 || to >= draft.fields.length) {
      return;
    }
    const list = [...draft.fields];
    [list[from], list[to]] = [list[to], list[from]];
    patch({ fields: list });
  };
  const setFieldSlots = (fieldId, slotIds) =>
    patchField(fieldId, {
      slotIds: slotIds.length === 0 || slotIds.length >= allowedSlots.length ? null : slotIds,
    });
  const previewState = { ...state, types: upsertById(state.types, draft) };
  const sample = {
    typeId: draft.id,
    slotId: allowedSlots[0]?.id || null,
    date: todayIso(),
    note: "",
    values: Object.fromEntries(
      draft.fields.map((field) => {
        const def = state.fields.find((f) => f.id === field.fieldId);
        return [
          field.fieldId,
          def
            ? isPeopleField(def)
              ? def.kind === "people"
                ? ["Alex", "Sam"]
                : ["Alex"]
              : def.kind === "time"
                ? "09:30"
                : t("types.sampleText")
            : "",
        ];
      }),
    ),
  };
  const previewTitle = eventTitle(previewState, sample);
  // Example description built from the first fields: "Team leader: {lead}".
  const descPlaceholder =
    state.fields
      .slice(0, 2)
      .map((field) => t("template.fieldLine", { label: field.label, value: `{${field.key}}` }))
      .join("\n") || t("types.descriptionPlaceholder");
  const save = () => {
    if (!draft.name.trim()) {
      return toast(t("types.needName"));
    }
    const times = {};
    for (const [slotId, hours] of Object.entries(draft.times || {})) {
      if (draft.slotIds.includes(slotId) && customHours) {
        times[slotId] = hours;
      }
    }
    const saved = {
      ...draft,
      name: draft.name.trim(),
      code: (draft.code || draft.name).trim().toUpperCase().slice(0, 6),
      times,
    };
    updateState((prev) => pruneReferences({ ...prev, types: upsertById(prev.types, saved) }), {
      label: t("undo.type"),
    });
    onClose();
  };
  return (
    <Sheet
      onClose={onClose}
      tall={true}
      title={isNew ? t("types.new") : draft.name || t("types.edit")}
      footer={
        <div class="row gap-s">
          {!isNew && (
            <Button
              kind="danger"
              icon="trash"
              aria-label={t("common.delete")}
              onClick={async () => {
                const count = state.events.filter((ev) => ev.typeId === draft.id).length;
                if (
                  await confirmDialog({
                    title: t("types.deleteTitle"),
                    text: count ? t("types.deleteTextEvents", { n: count }) : t("types.deleteText"),
                    confirmLabel: t("common.delete"),
                    danger: true,
                  })
                ) {
                  updateState(
                    (prev) => pruneReferences({ ...prev, types: removeById(prev.types, draft.id) }),
                    { label: t("types.deleted") },
                  );
                  toast(t("types.deleted"), { action: { label: t("common.undo"), run: undo } });
                  onClose();
                }
              }}
            />
          )}
          <Button kind="primary" block={true} onClick={save}>
            {t("common.save")}
          </Button>
        </div>
      }
    >
      <div class="two grow-1">
        <Field label={t("common.name")} for="ty-name">
          <TextInput
            id="ty-name"
            value={draft.name}
            onInput={(value) => patch({ name: value })}
            placeholder={t("types.namePlaceholder")}
          />
        </Field>
        <Field label={t("types.code")} for="ty-code">
          <TextInput
            id="ty-code"
            value={draft.code}
            onInput={(value) => patch({ code: value.toUpperCase() })}
            placeholder={t("types.codePlaceholder")}
            maxLength={6}
          />
        </Field>
      </div>
      <div class="blk">
        <div class="cap">{t("types.color")}</div>
        <div class="swatches" role="radiogroup">
          {COLORS.map((color) => (
            <button
              type="button"
              role="radio"
              aria-checked={draft.color === color.id}
              aria-label={color.name}
              title={color.name}
              class={`sw-c ${draft.color === color.id ? "on" : ""}`}
              style={{ "--c": color.hex, "--ct": contrastText(color.hex) }}
              onClick={() => patch({ color: color.id })}
              key={color.id}
            >
              {draft.color === color.id && <Icon n="check" size={16} sw={3} />}
            </button>
          ))}
        </div>
        <p class="muted small">{colorById(draft.color).name}</p>
      </div>
      <div class="blk">
        <div class="cap">{t("types.kind")}</div>
        <Segmented
          value={draft.kind}
          onChange={(value) => patch({ kind: value })}
          options={[
            { v: "slot", label: t("types.kind.slot"), sub: t("types.kind.slotSub") },
            { v: "allday", label: t("types.kind.allday"), sub: t("types.kind.alldaySub") },
          ]}
        />
      </div>
      {draft.kind === "slot" ? (
        <>
          <div class="blk">
            <div class="cap">{t("types.slots")}</div>
            <ChipPicker
              multi={true}
              value={draft.slotIds}
              onChange={(value) =>
                patch({
                  slotIds: state.slots.filter((slot) => value.includes(slot.id)).map((slot) => slot.id),
                })
              }
              options={state.slots.map((slot) => ({
                v: slot.id,
                label: `${slot.code} · ${formatTime(slot.start)}–${formatTime(slot.end)}`,
              }))}
              empty={t("types.noSlots")}
            />
            {draft.slotIds.length === 1 && (
              <p class="muted small">
                <Icon n="check" size={14} /> {t("types.singleSlot")}
              </p>
            )}
          </div>
          {allowedSlots.length > 0 && (
            <div class="blk">
              <Toggle
                id="ty-hours"
                checked={customHours}
                onChange={setCustomHours}
                label={t("types.customHours")}
                hint={t("types.customHoursHint")}
              />
              {customHours && (
                <div class="stack tight">
                  {allowedSlots.map((slot) => {
                    const hours = draft.times?.[slot.id] || { start: slot.start, end: slot.end };
                    const setHours = (changes) =>
                      patch({ times: { ...draft.times, [slot.id]: { ...hours, ...changes } } });
                    return (
                      <div class="hrow" key={slot.id}>
                        <b>{slot.code}</b>
                        <input
                          class="inp"
                          type="time"
                          aria-label={t("types.startOf", { code: slot.code })}
                          value={hours.start}
                          onInput={(ev) => setHours({ start: ev.currentTarget.value || hours.start })}
                        />
                        <span>→</span>
                        <input
                          class="inp"
                          type="time"
                          aria-label={t("types.endOf", { code: slot.code })}
                          value={hours.end}
                          onInput={(ev) => setHours({ end: ev.currentTarget.value || hours.end })}
                        />
                        <small class="muted">{endsNextDay(hours.start, hours.end) ? t("time.nextDayShort") : ""}</small>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div class="blk">
          <div class="cap">{t("editor.length")}</div>
          <Toggle
            id="ty-week"
            checked={draft.snapWeek}
            onChange={(value) => patch({ snapWeek: value, days: value ? 7 : draft.days })}
            label={t("types.wholeWeek")}
            hint={t("types.wholeWeekHint")}
          />
          {!draft.snapWeek && (
            <div class="row gap-s center">
              <Stepper
                value={draft.days}
                onChange={(value) => patch({ days: value })}
                min={1}
                max={60}
                format={(n) => t("common.days", { n })}
              />
              <span class="muted small">{t("types.defaultLength")}</span>
            </div>
          )}
        </div>
      )}
      <Section title={t("types.fields")} hint={t("types.fieldsHint")}>
        {state.fields.length === 0 && <p class="muted small">{t("types.noFields")}</p>}
        <div class="stack">
          {draft.fields.map((field, index) => {
            const def = state.fields.find((f) => f.id === field.fieldId);
            return def ? (
              <div class="fcfg on" key={def.id}>
                <div class="fcfg-h">
                  <button
                    type="button"
                    class="cbx on"
                    aria-label={t("types.removeField", { label: def.label })}
                    onClick={() => toggleField(def.id)}
                  >
                    <Icon n="check" size={15} sw={3} />
                  </button>
                  <b>{def.label}</b>
                  <span class="grow" />
                  <button
                    type="button"
                    class="ibtn sm"
                    aria-label={t("common.moveUp")}
                    disabled={index === 0}
                    onClick={() => moveField(def.id, -1)}
                  >
                    <Icon n="arrowUp" size={16} />
                  </button>
                  <button
                    type="button"
                    class="ibtn sm"
                    aria-label={t("common.moveDown")}
                    disabled={index === draft.fields.length - 1}
                    onClick={() => moveField(def.id, 1)}
                  >
                    <Icon n="arrowDown" size={16} />
                  </button>
                </div>
                {draft.kind === "slot" && allowedSlots.length > 1 && (
                  <div class="fcfg-b">
                    <small class="muted">{t("types.shownOn")}</small>
                    <ChipPicker
                      multi={true}
                      value={field.slotIds || allowedSlots.map((slot) => slot.id)}
                      onChange={(value) => setFieldSlots(def.id, value)}
                      options={allowedSlots.map((slot) => ({ v: slot.id, label: slot.code }))}
                    />
                  </div>
                )}
                <label class="mini-t">
                  <input
                    type="checkbox"
                    checked={!!field.required}
                    onChange={(ev) => patchField(def.id, { required: ev.currentTarget.checked })}
                  />
                  {" "}
                  {t("types.required")}
                </label>
              </div>
            ) : null;
          })}
          {state.fields
            .filter((field) => !fieldConfig(field.id))
            .map((field) => (
              <div class="fcfg" key={field.id}>
                <div class="fcfg-h">
                  <button
                    type="button"
                    class="cbx"
                    aria-label={t("types.addField", { label: field.label })}
                    onClick={() => toggleField(field.id)}
                  />
                  <b class="muted">{field.label}</b>
                </div>
              </div>
            ))}
        </div>
      </Section>
      <Section title={t("types.titleSection")}>
        <Field label={t("types.titleTemplate")} for="ty-title" hint={t("types.titleHint")}>
          <TextInput
            id="ty-title"
            value={draft.titleTpl}
            onInput={(value) => patch({ titleTpl: value })}
            spellcheck={false}
          />
        </Field>
        <div class="chips tight">
          {templateVariables(state).map((variable) => (
            <button
              type="button"
              class="chip sm"
              onClick={() =>
                patch({
                  titleTpl: `${draft.titleTpl}${draft.titleTpl && !draft.titleTpl.endsWith(" ") && !draft.titleTpl.endsWith("[") ? " " : ""}{${variable.k}}`,
                })
              }
              key={variable.k}
            >
              {"+ "}
              {variable.label}
            </button>
          ))}
          <button type="button" class="chip sm" onClick={() => patch({ titleTpl: defaultTitleTemplate(state) })}>
            {t("types.defaultTitle")}
          </button>
        </div>
        <div
          class="preview mini"
          style={{ "--c": colorById(draft.color).hex, "--ct": contrastText(colorById(draft.color).hex) }}
        >
          <i class="pv-bar" />
          <div>
            <strong>{previewTitle || "—"}</strong>
            <span>{t("types.preview")}</span>
          </div>
        </div>
        <Field label={t("types.description")} for="ty-desc" hint={t("types.descriptionHint")}>
          <textarea
            id="ty-desc"
            class="inp"
            rows={3}
            value={draft.descTpl}
            onInput={(ev) => patch({ descTpl: ev.currentTarget.value })}
            placeholder={descPlaceholder}
            spellcheck={false}
          />
        </Field>
        <Field label={t("types.location")} for="ty-loc">
          <TextInput id="ty-loc" value={draft.location} onInput={(value) => patch({ location: value })} />
        </Field>
      </Section>
      <Section title={t("types.reminders")}>
        <ChipPicker
          multi={true}
          value={draft.alarms}
          onChange={(value) => patch({ alarms: [...value].sort((a, b) => a - b) })}
          options={alarmOptions()}
        />
        <p class="muted small">{t("types.remindersHint")}</p>
      </Section>
      {!isNew && (
        <Button
          block={true}
          icon="copy"
          kind="soft"
          onClick={() => {
            const copy = {
              ...draft,
              id: newId("t"),
              name: t("types.copyName", { name: draft.name }),
              code: "",
              color: COLORS[(COLORS.findIndex((c) => c.id === draft.color) + 1) % COLORS.length].id,
            };
            updateState((prev) => ({ ...prev, types: [...prev.types, copy] }), { label: t("undo.type") });
            toast(t("types.duplicated"));
            onClose();
          }}
        >
          {t("types.duplicate")}
        </Button>
      )}
    </Sheet>
  );
}

export function TypesPage({ onBack, Back }) {
  const state = useAppState();
  const [editing, setEditing] = useState(null);
  const summary = (type) =>
    type.kind === "allday"
      ? type.snapWeek
        ? t("types.wholeWeek")
        : `${t("types.kind.allday")} · ${t("common.days", { n: type.days })}`
      : `${
          state.slots
            .filter((slot) => type.slotIds.includes(slot.id))
            .map((slot) => slot.code)
            .join(" · ") || t("types.noSlot")
        } · ${t("types.fieldCount", { n: type.fields.length })}`;
  return (
    <div class="page">
      <Back
        title={t("settings.types")}
        onBack={onBack}
        right={
          <Button small={true} kind="soft" icon="plus" onClick={() => setEditing(newType(state))}>
            {t("common.add")}
          </Button>
        }
      />
      <div class="scroll">
        <p class="lead">{t("types.lead")}</p>
        {state.types.length === 0 && (
          <EmptyState icon="calendar" title={t("types.empty")} text={t("types.emptyHint")} />
        )}
        <div class="stack">
          {state.types.map((type, index) => (
            <ListItem
              left={<i class="tdot" style={{ "--c": colorById(type.color).hex }} />}
              title={
                <>
                  {type.name} <Badge>{type.code}</Badge>
                </>
              }
              sub={summary(type)}
              onClick={() => setEditing(type)}
              right={
                <span class="row" onClick={(ev) => ev.stopPropagation()}>
                  <button
                    type="button"
                    class="ibtn sm"
                    aria-label={t("common.moveUp")}
                    disabled={index === 0}
                    onClick={() =>
                      updateState((prev) => ({ ...prev, types: moveById(prev.types, type.id, -1) }), {
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
                    disabled={index === state.types.length - 1}
                    onClick={() =>
                      updateState((prev) => ({ ...prev, types: moveById(prev.types, type.id, 1) }), {
                        undo: false,
                      })
                    }
                  >
                    <Icon n="arrowDown" size={16} />
                  </button>
                </span>
              }
              key={type.id}
            />
          ))}
        </div>
      </div>
      {editing && <TypeEditor type={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
