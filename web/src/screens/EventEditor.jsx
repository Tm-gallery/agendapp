// Event entry and editing: type, slot, length, fields (names, time, text) and note, with values
// prefilled by the rules and name suggestions.
import { useState, useRef, useEffect, useMemo } from "preact/hooks";
import { t } from "../i18n/index.js";
import { addDays, formatDateList, formatDateShort, groupConsecutive, weekStart } from "../lib/dates.js";
import { haptic } from "../lib/haptics.js";
import { colorById, findSlot, findType, isPeopleField, typeFields } from "../lib/model.js";
import { knownNames, nameSuggestions, prefillFor, uniqueNames } from "../lib/rules.js";
import { useAppState } from "../lib/store.js";
import { eventTitle } from "../lib/templates.js";
import { slotLabel } from "../lib/timing.js";
import { Icon } from "../ui/Icon.jsx";
import { Sheet } from "../ui/Sheet.jsx";
import { Badge, Button, ChipPicker, Field, Segmented, Stepper, contrastText } from "../ui/components.jsx";

/**
 * Names field (one or several people). Typed text is committed when the input loses focus,
 * except when focus moves because a suggestion is being tapped: otherwise typing "ma" and then
 * tapping "MARTIN" would save "ma" (and a single-person input disappears as soon as a name is
 * picked, which also blurs it).
 */
function PeopleField({ field, value, onChange, review, onConfirm, sugg, allNames, required, id }) {
  const [text, setText] = useState("");
  const single = field.kind === "person";
  const inputRef = useRef(null);
  const pickingAt = useRef(0);
  // Tapping a suggestion keeps the focus (and the keyboard) in the input.
  const chipPress = {
    onPointerDown: () => (pickingAt.current = Date.now()),
    onMouseDown: (ev) => ev.preventDefault(),
  };
  const commit = (raw) => {
    const parts = String(raw)
      .split(/[,;\n]/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length) {
      haptic(6);
      onChange(single ? [parts[0]] : uniqueNames([...value, ...parts]));
      setText("");
    }
  };
  const remove = (candidate) => onChange(value.filter((name) => name !== candidate));
  const pick = (candidate) => {
    haptic(6);
    onChange(single ? [candidate] : uniqueNames([...value, candidate]));
    setText("");
  };
  const query = text.trim().toLowerCase();
  const matches = query
    ? allNames
        .filter(
          (candidate) =>
            candidate.toLowerCase().includes(query) &&
            !value.some((name) => name.toLowerCase() === candidate.toLowerCase()),
        )
        .slice(0, 5)
    : [];
  const chosen = new Set(value.map((name) => name.toLowerCase()));
  const dayNames = (sugg?.day || []).filter((s) => !chosen.has(s.name.toLowerCase()));
  const ruleNames = (sugg?.rule || []).filter(
    (candidate) =>
      !chosen.has(candidate.toLowerCase()) &&
      !dayNames.some((d) => d.name.toLowerCase() === candidate.toLowerCase()),
  );
  const recentNames = (sugg?.recent || []).filter((s) => !chosen.has(s.name.toLowerCase()));
  return (
    <div class="fld">
      <div class="fld-h">
        <label for={id}>
          {field.label}
          {required ? " *" : ""}
        </label>
        {review && (
          <button type="button" class="rv" onClick={onConfirm} title={t("editor.markChecked")}>
            <Icon n="eye" size={13} sw={2.2} /> {t("event.toReview")}
            <b>{t("editor.ok")}</b>
          </button>
        )}
      </div>
      <div class={`ppl ${review ? "is-review" : ""}`} onClick={() => inputRef.current?.focus()}>
        {value.map((name) => (
          <span class="pchip" key={name}>
            {name}
            <button
              type="button"
              aria-label={t("editor.removeName", { name })}
              onClick={(ev) => {
                ev.stopPropagation();
                remove(name);
              }}
            >
              <Icon n="x" size={13} sw={2.4} />
            </button>
          </span>
        ))}
        {!(single && value.length) && (
          <input
            id={id}
            ref={inputRef}
            class="ppl-in"
            value={text}
            placeholder={value.length ? "" : single ? t("editor.name") : t("editor.addName")}
            autocomplete="off"
            autocapitalize="words"
            enterkeyhint="done"
            onInput={(ev) => {
              const v = ev.currentTarget.value;
              if (/[,;]$/.test(v)) {
                commit(v);
              } else {
                setText(v);
              }
            }}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") {
                ev.preventDefault();
                commit(text);
              } else if (ev.key === "Backspace" && !text && value.length) {
                onChange(value.slice(0, -1));
              }
            }}
            onBlur={(ev) => {
              const toChip = ev.relatedTarget?.closest?.(".sug .schip");
              if (toChip || Date.now() - pickingAt.current < 1500) return;
              if (text.trim()) commit(text);
            }}
          />
        )}
      </div>
      {matches.length > 0 && (
        <div class="sug sug-auto">
          {matches.map((name) => (
            <button type="button" class="schip" {...chipPress} onClick={() => pick(name)} key={name}>
              {name}
            </button>
          ))}
        </div>
      )}
      {(dayNames.length > 0 || ruleNames.length > 0 || recentNames.length > 0) && (
        <div class="sug">
          {dayNames.map((s) => (
            <button
              type="button"
              class="schip day"
              {...chipPress}
              onClick={() => pick(s.name)}
              key={"d" + s.name}
            >
              <span>{s.name}</span>
              <small>{s.tags.slice(0, 2).join(" · ")}</small>
            </button>
          ))}
          {ruleNames.map((name) => (
            <button
              type="button"
              class="schip day"
              {...chipPress}
              onClick={() => pick(name)}
              key={"r" + name}
            >
              <span>{name}</span>
              <small>{t("editor.fromRule")}</small>
            </button>
          ))}
          {recentNames.map((s) => (
            <button
              type="button"
              class="schip"
              {...chipPress}
              onClick={() => pick(s.name)}
              key={"h" + s.name}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TimeField({ field, value, onChange, id, required }) {
  return (
    <div class="fld">
      <div class="fld-h">
        <label for={id}>
          {field.label}
          {required ? " *" : ""}
        </label>
      </div>
      <div class="row gap-s">
        <input
          id={id}
          class="inp"
          type="time"
          value={value || ""}
          onInput={(ev) => onChange(ev.currentTarget.value)}
        />
        {value && (
          <button
            type="button"
            class="ibtn"
            aria-label={t("editor.clearField", { label: field.label })}
            onClick={() => onChange("")}
          >
            <Icon n="x" size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

function TextField({ field, value, onChange, id, required }) {
  return (
    <div class="fld">
      <div class="fld-h">
        <label for={id}>
          {field.label}
          {required ? " *" : ""}
        </label>
      </div>
      <input
        id={id}
        class="inp"
        type="text"
        value={value || ""}
        onInput={(ev) => onChange(ev.currentTarget.value)}
        autocomplete="off"
      />
    </div>
  );
}

export function EventEditor({ mode, dates = [], event, onSubmit, onDelete, onClose, title }) {
  const state = useAppState();
  const editing = mode !== "create";
  const [typeId, setTypeId] = useState(
    event?.typeId ?? (state.types.length === 1 ? state.types[0].id : null),
  );
  const selectedType = findType(state, typeId);
  const [selectedSlotId, setSelectedSlotId] = useState(event?.slotId ?? null);
  const [date, setDate] = useState(event?.date ?? dates[0]);
  const [values, setValues] = useState(event?.values ?? {});
  const [review, setReview] = useState(event?.review ?? {});
  const [touched, setTouched] = useState({});
  const [note, setNote] = useState(event?.note ?? "");
  const [days, setDays] = useState(event?.days ?? 0);
  const refDate = editing ? date : dates[0];
  const slots =
    selectedType?.kind === "slot"
      ? selectedType.slotIds.map((slotId) => findSlot(state, slotId)).filter(Boolean)
      : [];
  useEffect(() => {
    if (selectedType) {
      if (selectedType.kind === "allday") {
        setSelectedSlotId(null);
        return;
      }
      if (!slots.some((slot) => slot.id === selectedSlotId)) {
        setSelectedSlotId(slots.length === 1 ? slots[0].id : null);
      }
    }
  }, [typeId]);
  useEffect(() => {
    if (selectedType?.kind === "allday" && !(editing && typeId === event?.typeId)) {
      setDays(selectedType.days || 1);
    }
  }, [typeId]);
  const defs = useMemo(
    () =>
      selectedType
        ? typeFields(state, selectedType.id, selectedType.kind === "slot" ? selectedSlotId : null)
        : [],
    [state, typeId, selectedSlotId],
  );
  const ready = !!selectedType && (selectedType.kind === "allday" || !!selectedSlotId);
  const prefill = useMemo(
    () =>
      !ready || mode === "edit" || mode === "candidate"
        ? null
        : prefillFor(state, {
            typeId,
            slotId: selectedType.kind === "slot" ? selectedSlotId : null,
            date: refDate,
          }),
    [typeId, selectedSlotId, refDate, ready, state.events.length],
  );
  useEffect(() => {
    if (prefill) {
      setValues((prev) => {
        const next = {};
        for (const { field } of defs) {
          next[field.id] = touched[field.id] ? prev[field.id] : prefill.values[field.id];
        }
        return next;
      });
      setReview(() => {
        const next = {};
        for (const { field } of defs) {
          if (!touched[field.id] && prefill.review[field.id]) {
            next[field.id] = true;
          }
        }
        return next;
      });
    }
  }, [prefill, defs]);
  const setField = (fieldId, value) => {
    setTouched((prev) => ({ ...prev, [fieldId]: true }));
    setValues((prev) => ({ ...prev, [fieldId]: value }));
    setReview((prev) => {
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  };
  const allNames = useMemo(() => knownNames(state), [state.people]);
  const suggestionsFor = (field) => {
    if (!isPeopleField(field) || !ready) {
      return null;
    }
    const chosen = values[field.id] || [];
    return {
      ...nameSuggestions(state, { date: refDate, draftId: event?.id, exclude: chosen }),
      rule: prefill?.suggestions?.[field.id] || [],
    };
  };
  const shortcuts = useMemo(
    () =>
      editing
        ? []
        : Object.entries(state.usage || {})
            .map(([key, use]) => ({ k: key, ...use, tid: key.split("|")[0], sid: key.split("|")[1] }))
            .filter(
              (s) =>
                findType(state, s.tid) &&
                (s.sid ? findSlot(state, s.sid) : findType(state, s.tid).kind === "allday"),
            )
            .sort((a, b) => b.n - a.n || b.t - a.t)
            .slice(0, 6),
    [state.usage, state.types, state.slots, editing],
  );
  const missing = defs.filter(({ field, required }) => {
    if (!required) {
      return false;
    }
    const value = values[field.id];
    return Array.isArray(value) ? !value.length : !String(value || "").trim();
  });
  const draft = {
    typeId,
    slotId: selectedType?.kind === "slot" ? selectedSlotId : null,
    date: refDate,
    values,
    note,
    days: days || selectedType?.days,
  };
  const previewTitle = ready ? eventTitle(state, draft) : "";
  const color = selectedType ? colorById(selectedType.color).hex : "#888";
  const submit = () => {
    const base = { typeId, slotId: selectedType.kind === "slot" ? selectedSlotId : null, note };
    if (editing) {
      onSubmit({
        ...base,
        date,
        days: (selectedType.kind === "allday" && (days || selectedType.days)) || 1,
        values,
        review,
      });
    } else {
      const touchedValues = {};
      for (const fieldId of Object.keys(touched)) {
        touchedValues[fieldId] = values[fieldId];
      }
      onSubmit({ ...base, dates, days: selectedType.kind === "allday" ? days : 1, touched: touchedValues });
    }
  };
  const dayCount = dates.length;
  const submitLabel = editing
    ? t(mode === "candidate" ? "editor.apply" : "common.save")
    : dayCount > 1
      ? t("editor.addDays", { n: dayCount })
      : t("common.add");
  const runs = groupConsecutive(dates);
  const durationHint =
    !selectedType || selectedType.kind !== "allday" || editing
      ? null
      : selectedType.snapWeek
        ? t("editor.wholeWeeks", { n: new Set(dates.map(weekStart)).size })
        : dates.length === 1
          ? null
          : runs.map((run) => t("summary.daysShort", { n: run.length })).join(" + ");
  return (
    <Sheet
      onClose={onClose}
      tall={true}
      title={title || t(editing ? "editor.edit" : "editor.new")}
      subtitle={editing ? formatDateShort(date) : formatDateList(dates)}
      footer={
        <div class="row gap-s">
          {onDelete && <Button kind="danger" icon="trash" onClick={onDelete} aria-label={t("common.delete")} />}
          <Button kind="primary" block={true} disabled={!ready || missing.length > 0} onClick={submit}>
            {submitLabel}
          </Button>
        </div>
      }
    >
      {!editing && shortcuts.length > 0 && (
        <div class="blk">
          <div class="cap">{t("editor.shortcuts")}</div>
          <div class="chips">
            {shortcuts.map((s) => {
              const shortcutType = findType(state, s.tid);
              const shortcutSlot = findSlot(state, s.sid);
              return (
                <button
                  type="button"
                  class={`chip ${typeId === s.tid && (selectedSlotId || "") === s.sid ? "on" : ""}`}
                  style={{
                    "--c": colorById(shortcutType.color).hex,
                    "--ct": contrastText(colorById(shortcutType.color).hex),
                  }}
                  onClick={() => {
                    haptic();
                    setTypeId(s.tid);
                    setSelectedSlotId(s.sid || null);
                  }}
                  key={s.k}
                >
                  <i class="dot" />
                  {shortcutType.name}
                  {shortcutSlot ? ` · ${shortcutSlot.code}` : ""}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div class="blk">
        <div class="cap">{t("editor.type")}</div>
        <ChipPicker
          value={typeId}
          onChange={(value) => {
            setTypeId(value);
          }}
          options={state.types.map((type) => ({
            v: type.id,
            label: type.name,
            color: colorById(type.color).hex,
          }))}
          empty={t("editor.noTypes")}
        />
      </div>
      {selectedType?.kind === "slot" && slots.length > 1 && (
        <div class="blk">
          <div class="cap">{t("editor.slot")}</div>
          <Segmented
            value={selectedSlotId}
            onChange={setSelectedSlotId}
            options={slots.map((type) => ({
              v: type.id,
              label: type.code,
              sub: slotLabel(state, selectedType, type.id).replace(" → ", "–"),
            }))}
          />
        </div>
      )}
      {selectedType?.kind === "slot" && slots.length === 1 && (
        <div class="lock">
          <Icon n="clock" size={16} />
          <span>
            <b>{slots[0].name}</b>
            {" · "}
            {slotLabel(state, selectedType, slots[0].id)}
          </span>
          <Badge icon="check">{t("editor.fixedSlot")}</Badge>
        </div>
      )}
      {selectedType?.kind === "slot" && slots.length === 0 && (
        <p class="muted small">{t("editor.noSlots")}</p>
      )}
      {selectedType?.kind === "allday" && (
        <div class="blk">
          <div class="cap">{t("editor.length")}</div>
          {editing || (dates.length === 1 && !selectedType.snapWeek) ? (
            <div class="row gap-s center">
              <Stepper
                value={days || selectedType.days || 1}
                onChange={setDays}
                min={1}
                max={60}
                format={(n) => t("common.days", { n })}
              />
              <span class="muted small">{t("editor.allDay")}</span>
            </div>
          ) : (
            <p class="muted small">{durationHint || t("editor.allDayCap")}</p>
          )}
        </div>
      )}
      {editing && (
        <div class="blk">
          <Field label={t("editor.date")} for="ev-date">
            <input
              id="ev-date"
              class="inp"
              type="date"
              value={date}
              onInput={(ev) => ev.currentTarget.value && setDate(ev.currentTarget.value)}
            />
          </Field>
        </div>
      )}
      {ready &&
        defs.map(({ field, required }) =>
          isPeopleField(field) ? (
            <PeopleField
              id={`f-${field.id}`}
              field={field}
              required={required}
              value={
                Array.isArray(values[field.id])
                  ? values[field.id]
                  : values[field.id]
                    ? [values[field.id]]
                    : []
              }
              onChange={(value) => setField(field.id, value)}
              review={!!review[field.id]}
              onConfirm={() =>
                setReview((prev) => {
                  const next = { ...prev };
                  delete next[field.id];
                  return next;
                })
              }
              sugg={suggestionsFor(field)}
              allNames={allNames}
              key={field.id}
            />
          ) : field.kind === "time" ? (
            <TimeField
              id={`f-${field.id}`}
              field={field}
              required={required}
              value={values[field.id]}
              onChange={(value) => setField(field.id, value)}
              key={field.id}
            />
          ) : (
            <TextField
              id={`f-${field.id}`}
              field={field}
              required={required}
              value={values[field.id]}
              onChange={(value) => setField(field.id, value)}
              key={field.id}
            />
          ),
        )}
      {ready && (
        <div class="fld">
          <div class="fld-h">
            <label for="ev-note">{t("editor.note")}</label>
          </div>
          <input
            id="ev-note"
            class="inp"
            type="text"
            value={note}
            onInput={(ev) => setNote(ev.currentTarget.value)}
            placeholder={t("common.optional")}
            autocomplete="off"
          />
        </div>
      )}
      {ready && !editing && dayCount > 1 && defs.some((def) => isPeopleField(def.field)) && (
        <p class="muted small note-multi">
          <Icon n="info" size={14} /> {t("editor.multiDayNames")}
        </p>
      )}
      {ready && (
        <div class="preview" style={{ "--c": color, "--ct": contrastText(color) }}>
          <i class="pv-bar" />
          <div>
            <strong>{previewTitle}</strong>
            <span>
              {selectedType.kind === "slot"
                ? slotLabel(state, selectedType, selectedSlotId)
                : t("event.allDayLength", { n: days || selectedType.days || 1 })}
              {selectedType.kind === "allday" &&
                !editing &&
                dates.length === 1 &&
                ` · ${t("editor.until", { date: formatDateShort(addDays(selectedType.snapWeek ? weekStart(dates[0]) : dates[0], (selectedType.snapWeek ? 7 : days || selectedType.days || 1) - 1)) })}`}
            </span>
          </div>
        </div>
      )}
    </Sheet>
  );
}
