// Flows around the editor: adding (then the rules' proposals), editing, deleting.
import { useState, useRef } from "preact/hooks";
import { t } from "../i18n/index.js";
import { formatDateShort } from "../lib/dates.js";
import { addEvents, cleanValues, deleteEvents, eventsFromForm, updateEvent } from "../lib/events.js";
import { haptic } from "../lib/haptics.js";
import { colorById, findType, typeFields } from "../lib/model.js";
import { proposalsFor } from "../lib/rules.js";
import { getState, undo, updateState, useAppState } from "../lib/store.js";
import { eventFieldsSummary, eventTitle } from "../lib/templates.js";
import { slotLabel } from "../lib/timing.js";
import { EventEditor } from "./EventEditor.jsx";
import { Icon } from "../ui/Icon.jsx";
import { toast } from "../ui/Overlays.jsx";
import { Sheet } from "../ui/Sheet.jsx";
import { Badge, Button, contrastText } from "../ui/components.jsx";

function ProposalsSheet({ cands, onClose, onAdded }) {
  const state = useAppState();
  const [items, setItems] = useState(cands);
  const [selected, setSelected] = useState(
    () => new Set(cands.filter((cand) => !cand.duplicate).map((cand) => cand.id)),
  );
  const [editing, setEditing] = useState(null);
  const toggle = (id) => {
    haptic();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };
  const chosen = items.filter((cand) => selected.has(cand.id));
  const addChosen = () => {
    const events = chosen.map(({ duplicate, ruleName, auto, ...rest }) => rest);
    updateState((prev) => addEvents(prev, events), { label: t("undo.proposals") });
    if (events.length) {
      toast(t("flows.added", { n: events.length }), { action: { label: t("common.undo"), run: undo } });
    }
    onClose();
  };
  return (
    <>
      <Sheet
        onClose={onClose}
        title={t("flows.proposals")}
        subtitle={t("flows.proposalsSub", { n: items.length })}
        footer={
          <div class="row gap-s">
            <Button kind="ghost" onClick={onClose}>
              {t("flows.ignore")}
            </Button>
            <Button kind="primary" block={true} disabled={!chosen.length} onClick={addChosen}>
              {chosen.length ? t("flows.addCount", { n: chosen.length }) : t("common.add")}
            </Button>
          </div>
        }
      >
        <div class="stack">
          {items.map((ev) => {
            const type = findType(state, ev.typeId);
            const color = colorById(type?.color).hex;
            const isOn = selected.has(ev.id);
            return (
              <div
                class={`prop ${isOn ? "on" : ""} ${ev.duplicate ? "dup" : ""}`}
                style={{ "--c": color, "--ct": contrastText(color) }}
                key={ev.id}
              >
                <button
                  type="button"
                  class="prop-check"
                  onClick={() => !ev.duplicate && toggle(ev.id)}
                  aria-pressed={isOn}
                  aria-label={t("flows.include")}
                  disabled={ev.duplicate}
                >
                  {isOn && <Icon n="check" size={16} sw={3} />}
                </button>
                <div class="prop-main" onClick={() => !ev.duplicate && toggle(ev.id)}>
                  <strong>{eventTitle(state, ev)}</strong>
                  <span>
                    {formatDateShort(ev.date)}
                    {ev.slotId
                      ? ` · ${slotLabel(state, type, ev.slotId)}`
                      : ` · ${t("summary.daysShort", { n: ev.days })}`}
                  </span>
                  {eventFieldsSummary(state, ev) && (
                    <span class="prop-v">{eventFieldsSummary(state, ev)}</span>
                  )}
                  <span class="prop-r">
                    <Icon n="bolt" size={12} /> {ev.ruleName}
                  </span>
                </div>
                {ev.duplicate ? (
                  <Badge tone="warn">{t("flows.exists")}</Badge>
                ) : (
                  <button
                    type="button"
                    class="ibtn"
                    aria-label={t("flows.editProposal")}
                    onClick={() => setEditing(ev)}
                  >
                    <Icon n="edit" size={18} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </Sheet>
      {editing && (
        <EventEditor
          mode="candidate"
          event={editing}
          title={t("flows.adjust")}
          onClose={() => setEditing(null)}
          onSubmit={(value) => {
            setItems((prev) =>
              prev.map((item) =>
                item.id === editing.id
                  ? {
                      ...item,
                      ...value,
                      values: cleanValues(
                        getState(),
                        value.typeId,
                        value.slotId,
                        value.values,
                        typeFields(getState(), value.typeId, value.slotId),
                      ),
                    }
                  : item,
              ),
            );
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

export function AddEventFlow({ dates, onDone }) {
  const [proposals, setProposals] = useState(null);
  const added = useRef(false);
  const submit = (ev) => {
    const before = getState();
    const created = eventsFromForm(before, ev);
    updateState((prev) => addEvents(prev, created), { label: t("undo.add") });
    const after = getState();
    const seen = new Set();
    const found = [];
    for (const newEv of created) {
      for (const proposal of proposalsFor(after, newEv)) {
        const key = `${proposal.date}|${proposal.typeId}|${proposal.slotId || ""}`;
        if (!seen.has(key)) {
          seen.add(key);
          found.push(proposal);
        }
      }
    }
    const auto = found.filter((p) => p.auto && !p.duplicate);
    const toReview = found.filter((p) => !(p.auto && !p.duplicate));
    if (auto.length) {
      updateState(
        (prev) =>
          addEvents(
            prev,
            auto.map(({ duplicate, ruleName, auto, ...rest }) => rest),
          ),
        { undo: false },
      );
    }
    const count = created.length + auto.length;
    haptic(14);
    added.current = true;
    if (toReview.length) {
      setProposals(toReview);
    } else {
      toast(auto.length ? t("flows.addedWithRules", { n: count, auto: auto.length }) : t("flows.added", { n: count }), {
        action: { label: t("common.undo"), run: undo },
      });
      onDone(true);
    }
  };
  return proposals ? (
    <ProposalsSheet cands={proposals} onClose={() => onDone(added.current)} />
  ) : (
    <EventEditor mode="create" dates={dates} onClose={() => onDone(added.current)} onSubmit={submit} />
  );
}

export function EditEventFlow({ eventId, onDone }) {
  const current = useAppState().events.find((ev) => ev.id === eventId);
  return current ? (
    <EventEditor
      mode="edit"
      event={current}
      onClose={onDone}
      onSubmit={(value) => {
        const state = getState();
        const values = cleanValues(
          state,
          value.typeId,
          value.slotId,
          value.values,
          typeFields(state, value.typeId, value.slotId),
        );
        const review = {};
        for (const fieldId of Object.keys(value.review || {})) {
          if (fieldId in values) {
            review[fieldId] = true;
          }
        }
        updateState(
          (prev) =>
            updateEvent(prev, current.id, {
              typeId: value.typeId,
              slotId: value.slotId,
              date: value.date,
              days: value.days,
              values,
              review,
              note: value.note,
            }),
          { label: t("undo.edit") },
        );
        toast(t("flows.edited"));
        onDone();
      }}
      onDelete={() => {
        updateState((prev) => deleteEvents(prev, [current.id]), { label: t("undo.delete") });
        toast(t("flows.deleted"), { action: { label: t("common.undo"), run: undo } });
        onDone();
      }}
    />
  ) : null;
}
