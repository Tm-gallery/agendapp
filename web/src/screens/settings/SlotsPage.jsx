// Settings › Time slots: recurring time ranges and slot groups.
import { useState } from "preact/hooks";
import { t } from "../../i18n/index.js";
import { formatTime, timeToMinutes } from "../../lib/dates.js";
import { moveById, pruneReferences, removeById, upsertById } from "../../lib/events.js";
import { endsNextDay, newId } from "../../lib/model.js";
import { formatHours } from "../../lib/stats.js";
import { undo, updateState, useAppState } from "../../lib/store.js";
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
  PageHeader,
  Section,
  TextInput,
} from "../../ui/components.jsx";

function SlotEditor({ slot, onClose }) {
  const state = useAppState();
  const [draft, setDraft] = useState(slot);
  const [newGroup, setNewGroup] = useState(null);
  const isNew = !state.slots.some((s) => s.id === slot.id);
  const overnight = endsNextDay(draft.start, draft.end);
  const duration = (timeToMinutes(draft.end) - timeToMinutes(draft.start) + 1440) % 1440 || 1440;
  return (
    <Sheet
      onClose={onClose}
      title={t(isNew ? "slots.new" : "slots.edit")}
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
                    title: t("slots.deleteTitle"),
                    text: t("slots.deleteText"),
                    confirmLabel: t("common.delete"),
                    danger: true,
                  })
                ) {
                  updateState(
                    (prev) => pruneReferences({ ...prev, slots: removeById(prev.slots, draft.id) }),
                    { label: t("slots.deleted") },
                  );
                  toast(t("slots.deleted"), { action: { label: t("common.undo"), run: undo } });
                  onClose();
                }
              }}
            />
          )}
          <Button
            kind="primary"
            block={true}
            onClick={() => {
              if (!draft.name.trim()) {
                return toast(t("slots.needName"));
              }
              updateState(
                (prev) =>
                  pruneReferences({
                    ...prev,
                    slots: upsertById(prev.slots, {
                      ...draft,
                      name: draft.name.trim(),
                      code: (draft.code || draft.name).trim().toUpperCase(),
                    }),
                  }),
                { label: t("undo.slot") },
              );
              onClose();
            }}
          >
            {t("common.save")}
          </Button>
        </div>
      }
    >
      <Field label={t("common.name")} for="sl-name">
        <TextInput
          id="sl-name"
          value={draft.name}
          onInput={(value) => setDraft({ ...draft, name: value })}
          placeholder={t("slots.namePlaceholder")}
        />
      </Field>
      <Field label={t("slots.code")} for="sl-code" hint={t("slots.codeHint")}>
        <TextInput
          id="sl-code"
          value={draft.code}
          onInput={(value) => setDraft({ ...draft, code: value.toUpperCase() })}
          placeholder={t("slots.codePlaceholder")}
          maxLength={6}
        />
      </Field>
      <div class="two">
        <Field label={t("slots.start")} for="sl-start">
          <input
            id="sl-start"
            class="inp"
            type="time"
            value={draft.start}
            onInput={(ev) => setDraft({ ...draft, start: ev.currentTarget.value || draft.start })}
          />
        </Field>
        <Field label={t("slots.end")} for="sl-end">
          <input
            id="sl-end"
            class="inp"
            type="time"
            value={draft.end}
            onInput={(ev) => setDraft({ ...draft, end: ev.currentTarget.value || draft.end })}
          />
        </Field>
      </div>
      <p class="muted small">
        <Icon n="clock" size={14} /> {formatTime(draft.start)}
        {" → "}
        {formatTime(draft.end)}
        {overnight ? t("slots.nextDay") : ""}
        {" · "}
        {formatHours(duration)}
      </p>
      <div class="blk">
        <div class="cap">{t("slots.group")}</div>
        <ChipPicker
          value={draft.groupId}
          onChange={(value) => setDraft({ ...draft, groupId: value })}
          options={state.groups.map((group) => ({ v: group.id, label: group.name }))}
        />
        {newGroup === null ? (
          <button type="button" class="chip sm add-chip" onClick={() => setNewGroup("")}>
            <Icon n="plus" size={14} /> {t("slots.newGroup")}
          </button>
        ) : (
          <div class="row gap-s">
            <input
              id="sl-newg"
              class="inp"
              type="text"
              placeholder={t("slots.groupPlaceholder")}
              value={newGroup}
              onInput={(ev) => setNewGroup(ev.currentTarget.value)}
              autoFocus={true}
              autocomplete="off"
            />
            <Button
              small={true}
              kind="soft"
              onClick={() => {
                const name = newGroup.trim();
                if (!name) {
                  return;
                }
                const group = { id: newId("g"), name };
                updateState((prev) => ({ ...prev, groups: [...prev.groups, group] }), { undo: false });
                setDraft({ ...draft, groupId: group.id });
                setNewGroup(null);
              }}
            >
              {t("common.create")}
            </Button>
          </div>
        )}
        <p class="muted small">{t("slots.groupHint")}</p>
      </div>
    </Sheet>
  );
}

function GroupEditor({ group, onClose }) {
  const state = useAppState();
  const [name, setName] = useState(group.name);
  const isNew = !state.groups.some((g) => g.id === group.id);
  const slotCount = state.slots.filter((slot) => slot.groupId === group.id).length;
  return (
    <Sheet
      onClose={onClose}
      title={t(isNew ? "slots.groupNew" : "slots.groupEdit")}
      footer={
        <div class="row gap-s">
          {!isNew && (
            <Button
              kind="danger"
              icon="trash"
              aria-label={t("common.delete")}
              disabled={slotCount > 0}
              onClick={() => {
                updateState(
                  (prev) => pruneReferences({ ...prev, groups: removeById(prev.groups, group.id) }),
                  { label: t("undo.group") },
                );
                onClose();
              }}
            />
          )}
          <Button
            kind="primary"
            block={true}
            onClick={() => {
              if (name.trim()) {
                updateState(
                  (prev) => ({ ...prev, groups: upsertById(prev.groups, { ...group, name: name.trim() }) }),
                  { label: t("undo.group") },
                );
                onClose();
              }
            }}
          >
            {t("common.save")}
          </Button>
        </div>
      }
    >
      <Field label={t("common.name")} for="gr-name">
        <TextInput id="gr-name" value={name} onInput={setName} placeholder={t("slots.groupNamePlaceholder")} />
      </Field>
      {slotCount > 0 && <p class="muted small">{t("slots.groupInUse", { n: slotCount })}</p>}
    </Sheet>
  );
}

export function SlotsPage({ onBack }) {
  const state = useAppState();
  const [editingSlot, setEditingSlot] = useState(null);
  const [editingGroup, setEditingGroup] = useState(null);
  const groupName = (id) => state.groups.find((group) => group.id === id)?.name || "—";
  return (
    <div class="page">
      <PageHeader title={t("settings.slots")} onBack={onBack} />
      <div class="scroll">
        <p class="lead">{t("slots.lead")}</p>
        <Section
          title={t("settings.slots")}
          action={
            <Button
              small={true}
              kind="soft"
              icon="plus"
              onClick={() => {
                if (state.groups.length) {
                  setEditingSlot({
                    id: newId("s"),
                    name: "",
                    code: "",
                    start: "08:00",
                    end: "12:00",
                    groupId: state.groups[0].id,
                  });
                } else {
                  const group = { id: newId("g"), name: t("slots.defaultGroup") };
                  updateState((prev) => ({ ...prev, groups: [...prev.groups, group] }), { undo: false });
                  setEditingSlot({
                    id: newId("s"),
                    name: "",
                    code: "",
                    start: "08:00",
                    end: "12:00",
                    groupId: group.id,
                  });
                }
              }}
            >
              {t("common.add")}
            </Button>
          }
        >
          {state.slots.length === 0 && (
            <EmptyState icon="clock" title={t("slots.empty")} text={t("slots.emptyHint")} />
          )}
          <div class="stack">
            {state.slots.map((slot, index) => (
              <ListItem
                title={
                  <>
                    {slot.name} <Badge>{slot.code}</Badge>
                  </>
                }
                sub={`${formatTime(slot.start)} → ${formatTime(slot.end)}${endsNextDay(slot.start, slot.end) ? t("time.nextDay") : ""} · ${t("slots.inGroup", { name: groupName(slot.groupId) })}`}
                onClick={() => setEditingSlot(slot)}
                right={
                  <span class="row" onClick={(ev) => ev.stopPropagation()}>
                    <button
                      type="button"
                      class="ibtn sm"
                      aria-label={t("common.moveUp")}
                      disabled={index === 0}
                      onClick={() =>
                        updateState((prev) => ({ ...prev, slots: moveById(prev.slots, slot.id, -1) }), {
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
                      disabled={index === state.slots.length - 1}
                      onClick={() =>
                        updateState((prev) => ({ ...prev, slots: moveById(prev.slots, slot.id, 1) }), {
                          undo: false,
                        })
                      }
                    >
                      <Icon n="arrowDown" size={16} />
                    </button>
                  </span>
                }
                key={slot.id}
              />
            ))}
          </div>
        </Section>
        <Section
          title={t("slots.groups")}
          hint={t("slots.groupsHint")}
          action={
            <Button
              small={true}
              kind="soft"
              icon="plus"
              onClick={() => setEditingGroup({ id: newId("g"), name: "" })}
            >
              {t("common.add")}
            </Button>
          }
        >
          <div class="stack">
            {state.groups.map((group) => (
              <ListItem
                title={group.name}
                sub={
                  state.slots
                    .filter((slot) => slot.groupId === group.id)
                    .map((slot) => slot.code)
                    .join(" · ") || t("slots.groupEmpty")
                }
                onClick={() => setEditingGroup(group)}
                key={group.id}
              />
            ))}
          </div>
        </Section>
      </div>
      {editingSlot && <SlotEditor slot={editingSlot} onClose={() => setEditingSlot(null)} />}
      {editingGroup && <GroupEditor group={editingGroup} onClose={() => setEditingGroup(null)} />}
    </div>
  );
}
