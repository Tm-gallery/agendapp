// Settings › Hours summary: what counts as worked hours, as time off, or not at all, and which
// names are included in the per-person summary.
import { useState } from "preact/hooks";
import { compareText, t } from "../../i18n/index.js";
import { monthTitle, todayIso } from "../../lib/dates.js";
import { colorById, isPeopleField } from "../../lib/model.js";
import { fieldCounts, formatHours, periodTotals, totalsLine, typeRule } from "../../lib/stats.js";
import { updateState, useAppState } from "../../lib/store.js";
import { Button, ListItem, Section, Segmented, Stepper, Toggle } from "../../ui/components.jsx";
import { Icon } from "../../ui/Icon.jsx";
import { confirmDialog, toast } from "../../ui/Overlays.jsx";
import { Sheet } from "../../ui/Sheet.jsx";

function saveStats(change) {
  updateState((prev) => ({ ...prev, stats: change(JSON.parse(JSON.stringify(prev.stats || {}))) }), {
    undo: false,
  });
}

const setTypeRule = (id, patch) =>
  saveStats((stats) => ({ ...stats, types: { ...stats.types, [id]: { ...stats.types?.[id], ...patch } } }));

/** Current month: bounds and title ("October 2026"). */
function currentMonth() {
  const [y, m] = todayIso().split("-").map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    from: `${y}-${pad(m)}-01`,
    to: m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`,
    label: monthTitle(y, m),
  };
}

/** One-line description of a type's rule. */
function ruleSummary(type, rule) {
  const allDay = type.kind === "allday";
  if (rule.cat === "ignore") return t("stats.sum.ignore");
  let text;
  if (rule.cat === "off") text = t(allDay ? "stats.sum.offDays" : "stats.sum.offNoHours");
  else if (allDay)
    text = rule.dur ? t("stats.sum.perDay", { hours: formatHours(rule.dur) }) : t("stats.sum.noHours");
  else if (rule.dur != null) text = t("stats.sum.fixed", { hours: formatHours(rule.dur) });
  else text = rule.pause ? t("stats.sum.slotPause", { n: rule.pause }) : t("stats.sum.slot");
  return rule.people ? text : `${text} · ${t("stats.sum.notPerPerson")}`;
}

export function StatsRulesSheet({ onClose }) {
  const state = useAppState();
  const [editingTypeId, setEditingTypeId] = useState(null);
  const month = currentMonth();
  const peopleFields = state.fields.filter(isPeopleField);
  const excluded = state.stats?.exclude || [];
  const excludedKeys = new Set(excluded.map((n) => n.toLowerCase()));
  const candidates = Object.keys(state.people || {})
    .filter((n) => !excludedKeys.has(n.toLowerCase()))
    .sort(compareText);
  const hasRules = state.stats && Object.keys(state.stats).length > 0;

  return (
    <>
      <Sheet onClose={onClose} tall={true} title={t("stats.title")} subtitle={t("stats.subtitle")}>
        <div class="callout">
          <Icon n="chart" size={18} />
          <div>
            <b>{month.label}</b>
            <p>{totalsLine(periodTotals(state, month.from, month.to))}</p>
          </div>
        </div>
        <Section title={t("stats.types")} hint={t("stats.typesHint")}>
          <div class="stack">
            {state.types.length === 0 && <p class="muted">{t("stats.noTypes")}</p>}
            {state.types.map((type) => (
              <ListItem
                left={
                  <span class="li-ico">
                    <i class="dot li-dot" style={{ background: colorById(type.color).hex }} />
                  </span>
                }
                title={type.name}
                sub={ruleSummary(type, typeRule(state, type))}
                onClick={() => setEditingTypeId(type.id)}
                key={type.id}
              />
            ))}
          </div>
        </Section>
        <Section title={t("summary.perPerson")} hint={t("stats.peopleHint")}>
          {peopleFields.length === 0 && <p class="muted">{t("stats.noPeopleFields")}</p>}
          {peopleFields.map((field) => (
            <Toggle
              id={`st-f-${field.id}`}
              checked={fieldCounts(state, field)}
              onChange={(on) =>
                saveStats((stats) => ({ ...stats, fields: { ...stats.fields, [field.id]: { people: on } } }))
              }
              label={field.label}
              hint={t("stats.fieldHint")}
              key={field.id}
            />
          ))}
          <div class="blk">
            <div class="cap">{t("stats.excluded")}</div>
            <div class="stack">
              {excluded.length > 0 && (
                <div class="chips">
                  {excluded.map((name) => (
                    <span class="pchip" key={name}>
                      {name}
                      <button
                        type="button"
                        aria-label={t("stats.include", { name })}
                        onClick={() =>
                          saveStats((stats) => ({
                            ...stats,
                            exclude: (stats.exclude || []).filter((n) => n !== name),
                          }))
                        }
                      >
                        <Icon n="x" size={14} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {candidates.length > 0 && (
                <div class="sel">
                  <select
                    aria-label={t("stats.exclude")}
                    value=""
                    onChange={(ev) => {
                      const name = ev.currentTarget.value;
                      if (name) saveStats((stats) => ({ ...stats, exclude: [...(stats.exclude || []), name] }));
                    }}
                  >
                    <option value="">{t("stats.excludePlaceholder")}</option>
                    {candidates.map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                  <Icon n="chevD" size={16} />
                </div>
              )}
            </div>
            {excluded.length === 0 && <p class="muted small">{t("stats.noneExcluded")}</p>}
          </div>
        </Section>
        {hasRules && (
          <Button
            kind="ghost"
            block={true}
            icon="undo"
            onClick={async () => {
              const ok = await confirmDialog({
                title: t("stats.resetTitle"),
                text: t("stats.resetText"),
                confirmLabel: t("stats.resetConfirm"),
              });
              if (ok) {
                saveStats(() => ({}));
                toast(t("stats.resetDone"));
              }
            }}
          >
            {t("stats.reset")}
          </Button>
        )}
      </Sheet>
      {editingTypeId && <TypeRuleSheet typeId={editingTypeId} onClose={() => setEditingTypeId(null)} />}
    </>
  );
}

function TypeRuleSheet({ typeId, onClose }) {
  const state = useAppState();
  const type = state.types.find((item) => item.id === typeId);
  if (!type) return null;
  const rule = typeRule(state, type);
  const allDay = type.kind === "allday";
  const month = currentMonth();
  const totals = periodTotals(
    { ...state, events: state.events.filter((ev) => ev.typeId === typeId) },
    month.from,
    month.to,
  );
  const count = totals.byType.get(typeId)?.n || 0;
  const noneOr = (format) => (v) => (v ? format(v) : t("stats.none"));

  return (
    <Sheet
      onClose={onClose}
      title={type.name}
      subtitle={t(allDay ? "stats.kind.allDay" : "stats.kind.timed")}
    >
      <div class="blk">
        <div class="cap">{t("stats.countsAs")}</div>
        <Segmented
          value={rule.cat}
          onChange={(cat) => setTypeRule(typeId, { cat })}
          options={["service", "off", "ignore"].map((v) => ({
            v,
            label: t(`stats.cat.${v}`),
            sub: t(`stats.cat.${v}Sub`),
          }))}
        />
      </div>
      {rule.cat === "service" && allDay && (
        <div class="blk">
          <div class="cap">{t("stats.hoursPerDay")}</div>
          <Stepper
            value={rule.dur || 0}
            onChange={(v) => setTypeRule(typeId, { dur: v || null })}
            min={0}
            max={1440}
            step={15}
            format={noneOr(formatHours)}
          />
          <p class="muted small">{t("stats.hoursPerDayHint")}</p>
        </div>
      )}
      {rule.cat === "service" && !allDay && (
        <>
          <div class="blk">
            <div class="cap">{t("stats.counted")}</div>
            <Segmented
              value={rule.dur != null ? "fixed" : "slot"}
              onChange={(v) => setTypeRule(typeId, { dur: v === "fixed" ? (rule.dur ?? 420) : null })}
              options={[
                { v: "slot", label: t("stats.counted.slot") },
                { v: "fixed", label: t("stats.counted.fixed") },
              ]}
            />
          </div>
          {rule.dur != null ? (
            <div class="blk">
              <div class="cap">{t("stats.duration")}</div>
              <Stepper
                value={rule.dur}
                onChange={(dur) => setTypeRule(typeId, { dur })}
                min={15}
                max={1440}
                step={15}
                format={formatHours}
              />
            </div>
          ) : (
            <div class="blk">
              <div class="cap">{t("stats.pause")}</div>
              <Stepper
                value={rule.pause || 0}
                onChange={(pause) => setTypeRule(typeId, { pause })}
                min={0}
                max={240}
                step={15}
                format={noneOr((v) => t("common.minutes", { n: v }))}
              />
              <p class="muted small">{t("stats.pauseHint")}</p>
            </div>
          )}
        </>
      )}
      {rule.cat !== "ignore" && (
        <Toggle
          id="st-people"
          checked={rule.people}
          onChange={(people) => setTypeRule(typeId, { people })}
          label={t("stats.countPeople")}
          hint={t("stats.countPeopleHint")}
        />
      )}
      <p class="muted small">
        {month.label} ·{" "}
        {count
          ? `${allDay ? t("summary.daysShort", { n: count }) : t("common.events", { n: count })} · ${totalsLine(totals)}`
          : t("stats.noneThisMonth")}
      </p>
    </Sheet>
  );
}
