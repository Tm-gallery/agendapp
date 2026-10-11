// Settings › People: the names offered while entering events (add, correct, merge, summary).
import { useState } from "preact/hooks";
import { compareText, t } from "../../i18n/index.js";
import { parseIso, todayIso } from "../../lib/dates.js";
import { addPerson, countEventsWithName, removePerson, renamePerson } from "../../lib/people.js";
import { formatHours, peopleStats } from "../../lib/stats.js";
import { undo, updateState, useAppState } from "../../lib/store.js";
import { PeopleReport } from "../PeopleReport.jsx";
import { Icon } from "../../ui/Icon.jsx";
import { toast } from "../../ui/Overlays.jsx";
import { Sheet } from "../../ui/Sheet.jsx";
import { Button, EmptyState, Field, ListItem, PageHeader, TextInput, Toggle } from "../../ui/components.jsx";

function PersonEditor({ name, onClose }) {
  const state = useAppState();
  const [value, setValue] = useState(name);
  const [inEvents, setInEvents] = useState(true);
  const count = countEventsWithName(state, name);
  const changed = value.trim() && value.trim() !== name;
  const merging =
    changed &&
    Object.keys(state.people).some(
      (other) => other !== name && other.toLowerCase() === value.trim().toLowerCase(),
    );
  return (
    <Sheet
      onClose={onClose}
      title={t("people.edit")}
      footer={
        <div class="row gap-s">
          <Button
            kind="danger"
            icon="trash"
            aria-label={t("people.remove")}
            onClick={() => {
              updateState((prev) => removePerson(prev, name), { label: t("people.removedShort") });
              toast(t("people.removed"), { action: { label: t("common.undo"), run: undo } });
              onClose();
            }}
          />
          <Button
            kind="primary"
            block={true}
            onClick={() => {
              if (!changed) {
                return onClose();
              }
              updateState((prev) => renamePerson(prev, name, value, { inEvents }), {
                label: t("people.renamed"),
              });
              toast(t(merging ? "people.merged" : "people.renamed"), {
                action: { label: t("common.undo"), run: undo },
              });
              onClose();
            }}
          >
            {t(merging ? "people.merge" : "common.save")}
          </Button>
        </div>
      }
    >
      <Field label={t("common.name")} for="nm-v">
        <TextInput id="nm-v" value={value} onInput={setValue} autocapitalize="words" />
      </Field>
      {changed && count > 0 && (
        <Toggle
          id="nm-all"
          checked={inEvents}
          onChange={setInEvents}
          label={t("people.fixEvents", { n: count })}
          hint={t("people.fixEventsHint")}
        />
      )}
      {merging && (
        <p class="muted small">
          <Icon n="info" size={14} /> {t("people.mergeHint", { name: value.trim() })}
        </p>
      )}
      <p class="muted small">{t("people.eventCount", { n: count })}</p>
    </Sheet>
  );
}

export function NamesPage({ onBack }) {
  const current = useAppState();
  const [input, setInput] = useState("");
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [showReport, setShowReport] = useState(false);
  const stats = new Map(peopleStats(current).map((s) => [s.name.toLowerCase(), s]));
  const entries = Object.entries(current.people).sort((a, b) => compareText(a[0], b[0]));
  const visible = entries.filter(([name]) => name.toLowerCase().includes(search.trim().toLowerCase()));
  const addNames = () => {
    const names = input
      .split(/[,;\n]/)
      .map((n) => n.trim())
      .filter(Boolean);
    if (names.length) {
      updateState((prev) => names.reduce((state, name) => addPerson(state, name), prev), {
        label: t("people.addedShort"),
      });
      setInput("");
      toast(t("people.added", { n: names.length }));
    }
  };
  return (
    <div class="page">
      <PageHeader
        title={t("settings.people")}
        onBack={onBack}
        right={
          <Button
            small={true}
            kind="soft"
            icon="chart"
            onClick={() => setShowReport(true)}
            disabled={!stats.size}
          >
            {t("people.summary")}
          </Button>
        }
      />
      <div class="scroll">
        <p class="lead">{t("people.lead")}</p>
        <div class="row gap-s">
          <input
            id="nm-add"
            class="inp"
            placeholder={t("people.addPlaceholder")}
            value={input}
            autocomplete="off"
            autocapitalize="words"
            enterkeyhint="done"
            onInput={(ev) => setInput(ev.currentTarget.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") {
                ev.preventDefault();
                addNames();
              }
            }}
          />
          <Button
            kind="primary"
            icon="plus"
            aria-label={t("common.add")}
            onClick={addNames}
            disabled={!input.trim()}
          />
        </div>
        <p class="muted small">{t("people.addHint")}</p>
        {entries.length > 8 && (
          <div class="search">
            <Icon n="search" size={18} />
            <input
              type="search"
              placeholder={t("people.search")}
              value={search}
              onInput={(ev) => setSearch(ev.currentTarget.value)}
              autocomplete="off"
              aria-label={t("people.search")}
            />
          </div>
        )}
        {entries.length === 0 && (
          <EmptyState icon="users" title={t("people.empty")} text={t("people.emptyHint")} />
        )}
        <div class="stack">
          {visible.map(([name, _info]) => (
            <ListItem
              title={name}
              sub={
                stats.get(name.toLowerCase())
                  ? t("people.report.line", {
                      n: stats.get(name.toLowerCase()).n,
                      hours: formatHours(stats.get(name.toLowerCase()).min),
                    })
                  : t("people.unused")
              }
              onClick={() => setEditing(name)}
              right={<Icon n="edit" size={16} />}
              chevron={false}
              key={name}
            />
          ))}
        </div>
      </div>
      {editing && <PersonEditor name={editing} onClose={() => setEditing(null)} />}
      {showReport && (
        <PeopleReport
          ym={{ y: parseIso(todayIso()).y, m: parseIso(todayIso()).m }}
          initial="all"
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}
