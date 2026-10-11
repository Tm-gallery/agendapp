// Settings › Rules: event proposals and prefills (see lib/rules.js).
import { useState } from "preact/hooks";
import { t } from "../../i18n/index.js";
import { weekdaysShort } from "../../lib/dates.js";
import { pruneReferences, removeById, upsertById } from "../../lib/events.js";
import { findType, newId } from "../../lib/model.js";
import { describeRule } from "../../lib/rules.js";
import { undo, updateState, useAppState } from "../../lib/store.js";
import { Icon } from "../../ui/Icon.jsx";
import { confirmDialog, toast } from "../../ui/Overlays.jsx";
import { Sheet } from "../../ui/Sheet.jsx";
import {
  Button,
  ChipPicker,
  EmptyState,
  Field,
  ListItem,
  Section,
  Segmented,
  Select,
  Stepper,
  TextInput,
  Toggle,
} from "../../ui/components.jsx";

const newProposeRule = (state) => ({
  id: newId("r"),
  kind: "propose",
  enabled: true,
  name: "",
  when: { typeIds: [], slotIds: [] },
  then: {
    typeId: state.types[0]?.id || "",
    slotId: "same",
    dayOffset: 0,
    copy: "all",
    clear: [],
    set: {},
    mode: "suggest",
  },
});

const newPrefillRule = (state) => ({
  id: newId("r"),
  kind: "prefill",
  enabled: true,
  name: "",
  when: { typeIds: [], slotIds: [] },
  then: {
    fieldId: state.fields[0]?.id || "",
    sources: [{ fieldId: state.fields[0]?.id || "", groupIds: [], typeIds: null }],
    mode: "fill",
    review: true,
  },
});

function RuleWhen({ rule, setRule }) {
  const state = useAppState();
  const when = rule.when || {};
  const patch = (changes) => setRule({ ...rule, when: { ...when, ...changes } });
  return (
    <Section title={t("rules.when")} hint={t("rules.whenHint")}>
      <div class="blk">
        <div class="cap">{t("editor.type")}</div>
        <ChipPicker
          multi={true}
          value={when.typeIds || []}
          onChange={(value) => patch({ typeIds: value })}
          options={state.types.map((type) => ({ v: type.id, label: type.name }))}
          empty={t("rules.noTypes")}
        />
      </div>
      <div class="blk">
        <div class="cap">{t("editor.slot")}</div>
        <ChipPicker
          multi={true}
          value={when.slotIds || []}
          onChange={(value) => patch({ slotIds: value })}
          options={state.slots.map((slot) => ({ v: slot.id, label: slot.code }))}
          empty={t("rules.noSlots")}
        />
      </div>
      <details class="more" open={!!when.dows?.length}>
        <summary>{t("rules.weekdays")}</summary>
        <ChipPicker
          multi={true}
          value={when.dows || []}
          onChange={(value) => patch({ dows: value })}
          options={weekdaysShort().map((label, i) => ({ v: i, label }))}
        />
      </details>
    </Section>
  );
}

function RuleProposeThen({ rule, setRule }) {
  const state = useAppState();
  const then = rule.then;
  const patch = (changes) => setRule({ ...rule, then: { ...then, ...changes } });
  const target = findType(state, then.typeId);
  const slotOptions = [
    { v: "same", label: t("rules.sameSlotOption") },
    ...(target?.kind === "slot"
      ? state.slots
          .filter((slot) => target.slotIds.includes(slot.id))
          .map((slot) => ({ v: slot.id, label: `${slot.name} (${slot.code})` }))
      : []),
  ];
  const copyMode = then.copy === "all" ? "all" : then.copy === "none" ? "none" : "pick";
  return (
    <Section title={t("rules.then")}>
      <Segmented
        value={then.mode}
        onChange={(value) => patch({ mode: value })}
        options={[
          { v: "suggest", label: t("rules.mode.suggest"), sub: t("rules.mode.suggestSub") },
          { v: "auto", label: t("rules.mode.auto"), sub: t("rules.mode.autoSub") },
        ]}
      />
      <Field label={t("rules.eventType")} for="ru-type">
        <Select
          id="ru-type"
          value={then.typeId}
          onChange={(value) => patch({ typeId: value, slotId: "same" })}
          options={state.types.map((type) => ({ v: type.id, label: type.name }))}
        />
      </Field>
      {target?.kind === "slot" && (
        <Field label={t("editor.slot")} for="ru-slot">
          <Select
            id="ru-slot"
            value={then.slotId || "same"}
            onChange={(value) => patch({ slotId: value })}
            options={slotOptions}
          />
        </Field>
      )}
      <div class="blk">
        <div class="cap">{t("rules.day")}</div>
        <div class="row gap-s center">
          <Stepper
            value={then.dayOffset || 0}
            onChange={(value) => patch({ dayOffset: value })}
            min={-14}
            max={14}
            format={(n) => t("summary.daysShort", { n })}
          />
          <span class="muted small">
            {(then.dayOffset || 0) === 0
              ? t("rules.sameDay")
              : then.dayOffset > 0
                ? t("rules.daysAfter", { n: then.dayOffset })
                : t("rules.daysBefore", { n: -then.dayOffset })}
          </span>
        </div>
      </div>
      <div class="blk">
        <div class="cap">{t("rules.copy")}</div>
        <Segmented
          value={copyMode}
          onChange={(value) => patch({ copy: value === "pick" ? [] : value })}
          options={[
            { v: "all", label: t("rules.copy.all") },
            { v: "pick", label: t("rules.copy.pick") },
            { v: "none", label: t("rules.copy.none") },
          ]}
        />
        {copyMode === "pick" && (
          <ChipPicker
            multi={true}
            value={Array.isArray(then.copy) ? then.copy : []}
            onChange={(value) => patch({ copy: value })}
            options={state.fields.map((field) => ({ v: field.id, label: field.label }))}
          />
        )}
        <p class="muted small">{t("rules.copyHint")}</p>
      </div>
      <details class="more" open={!!then.clear?.length}>
        <summary>{t("rules.clear")}</summary>
        <ChipPicker
          multi={true}
          value={then.clear || []}
          onChange={(value) => patch({ clear: value })}
          options={state.fields.map((field) => ({ v: field.id, label: field.label }))}
        />
      </details>
    </Section>
  );
}

function RulePrefillThen({ rule, setRule }) {
  const state = useAppState();
  const then = rule.then;
  const patch = (changes) => setRule({ ...rule, then: { ...then, ...changes } });
  const patchSource = (index, changes) =>
    patch({ sources: then.sources.map((source, i) => (i === index ? { ...source, ...changes } : source)) });
  return (
    <Section title={t("rules.prefillThen")} hint={t("rules.prefillThenHint")}>
      <Field label={t("rules.targetField")} for="ru-field">
        <Select
          id="ru-field"
          value={then.fieldId}
          onChange={(value) => patch({ fieldId: value })}
          options={state.fields.map((field) => ({ v: field.id, label: field.label }))}
        />
      </Field>
      <div class="blk">
        <div class="cap">{t("rules.from")}</div>
        <div class="stack">
          {then.sources.map((source, index) => (
            <div class="srcrow" key={index}>
              <div class="row gap-s center">
                {index > 0 && <span class="plus">+</span>}
                <div class="grow">
                  <Select
                    value={source.fieldId}
                    onChange={(value) => patchSource(index, { fieldId: value })}
                    options={state.fields.map((field) => ({ v: field.id, label: field.label }))}
                  />
                </div>
                {then.sources.length > 1 && (
                  <button
                    type="button"
                    class="ibtn sm"
                    aria-label={t("rules.removeSource")}
                    onClick={() => patch({ sources: then.sources.filter((_, i) => i !== index) })}
                  >
                    <Icon n="x" size={16} />
                  </button>
                )}
              </div>
              <div class="cap sm">{t("rules.fromGroup")}</div>
              <ChipPicker
                multi={true}
                value={source.groupIds || []}
                onChange={(value) => patchSource(index, { groupIds: value })}
                options={state.groups.map((group) => ({ v: group.id, label: group.name }))}
              />
            </div>
          ))}
        </div>
        <Button
          small={true}
          kind="soft"
          icon="plus"
          onClick={() =>
            patch({
              sources: [...then.sources, { fieldId: state.fields[0]?.id || "", groupIds: [], typeIds: null }],
            })
          }
        >
          {t("rules.addSource")}
        </Button>
        <p class="muted small">{t("rules.sourcesHint")}</p>
      </div>
      <Segmented
        value={then.mode}
        onChange={(value) => patch({ mode: value })}
        options={[
          { v: "fill", label: t("rules.fill"), sub: t("rules.fillSub") },
          { v: "suggest", label: t("rules.suggestNames"), sub: t("rules.suggestNamesSub") },
        ]}
      />
      {then.mode === "fill" && (
        <Toggle
          id="ru-review"
          checked={then.review !== false}
          onChange={(value) => patch({ review: value })}
          label={t("rules.review")}
          hint={t("rules.reviewHint")}
        />
      )}
    </Section>
  );
}

function RuleEditor({ rule, onClose }) {
  const state = useAppState();
  const [draft, setDraft] = useState(rule);
  const isNew = !state.rules.some((r) => r.id === rule.id);
  const save = () => {
    if (draft.kind === "propose" && !draft.then.typeId) {
      return toast(t("rules.needType"));
    }
    if (
      draft.kind === "prefill" &&
      (!draft.then.fieldId ||
        !draft.then.sources.length ||
        draft.then.sources.some((source) => !source.fieldId))
    ) {
      return toast(t("rules.needSources"));
    }
    updateState(
      (prev) =>
        pruneReferences({ ...prev, rules: upsertById(prev.rules, { ...draft, name: draft.name.trim() }) }),
      { label: t("undo.rule") },
    );
    onClose();
  };
  return (
    <Sheet
      onClose={onClose}
      tall={true}
      title={isNew ? t(draft.kind === "propose" ? "rules.newPropose" : "rules.newPrefill") : t("rules.edit")}
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
                    title: t("rules.deleteTitle"),
                    confirmLabel: t("common.delete"),
                    danger: true,
                  })
                ) {
                  updateState((prev) => ({ ...prev, rules: removeById(prev.rules, draft.id) }), {
                    label: t("rules.deleted"),
                  });
                  toast(t("rules.deleted"), { action: { label: t("common.undo"), run: undo } });
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
      <Field label={t("rules.name")} for="ru-name" hint={describeRule(state, draft)}>
        <TextInput
          id="ru-name"
          value={draft.name}
          onInput={(value) => setDraft({ ...draft, name: value })}
          placeholder={t("rules.namePlaceholder")}
        />
      </Field>
      <RuleWhen rule={draft} setRule={setDraft} />
      {draft.kind === "propose" ? (
        <RuleProposeThen rule={draft} setRule={setDraft} />
      ) : (
        <RulePrefillThen rule={draft} setRule={setDraft} />
      )}
    </Sheet>
  );
}

export function RulesPage({ onBack, Back }) {
  const state = useAppState();
  const [editing, setEditing] = useState(null);
  const toggleRule = (target) =>
    updateState(
      (prev) => ({
        ...prev,
        rules: prev.rules.map((rule) =>
          rule.id === target.id ? { ...rule, enabled: rule.enabled === false } : rule,
        ),
      }),
      { undo: false },
    );
  const [choosing, setChoosing] = useState(false);
  return (
    <div class="page">
      <Back
        title={t("settings.rules")}
        onBack={onBack}
        right={
          <Button small={true} kind="soft" icon="plus" onClick={() => setChoosing(true)}>
            {t("common.add")}
          </Button>
        }
      />
      <div class="scroll">
        <p class="lead">{t("rules.lead")}</p>
        {state.rules.length === 0 && (
          <EmptyState icon="bolt" title={t("rules.empty")} text={t("rules.emptyHint")} />
        )}
        <div class="stack">
          {state.rules.map((rule) => (
            <ListItem
              class={rule.enabled === false ? "off" : ""}
              left={
                <span class="li-ico">
                  <Icon n={rule.kind === "propose" ? "bolt" : "wand"} size={18} />
                </span>
              }
              title={rule.name || t(rule.kind === "propose" ? "rules.kind.propose" : "rules.kind.prefill")}
              sub={describeRule(state, rule)}
              onClick={() => setEditing(rule)}
              right={
                <label class="mini-sw" onClick={(ev) => ev.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={t("rules.enable")}
                    checked={rule.enabled !== false}
                    onChange={() => toggleRule(rule)}
                  />
                  <i />
                </label>
              }
              key={rule.id}
            />
          ))}
        </div>
      </div>
      {choosing && (
        <Sheet title={t("rules.choose")} onClose={() => setChoosing(false)}>
          <div class="stack">
            <ListItem
              class="big"
              left={
                <span class="li-ico">
                  <Icon n="bolt" size={20} />
                </span>
              }
              title={t("rules.choose.propose")}
              sub={t("rules.choose.proposeHint")}
              onClick={() => {
                setChoosing(false);
                setEditing(newProposeRule(state));
              }}
            />
            <ListItem
              class="big"
              left={
                <span class="li-ico">
                  <Icon n="wand" size={20} />
                </span>
              }
              title={t("rules.choose.prefill")}
              sub={t("rules.choose.prefillHint")}
              onClick={() => {
                setChoosing(false);
                setEditing(newPrefillRule(state));
              }}
            />
          </div>
        </Sheet>
      )}
      {editing && <RuleEditor rule={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
