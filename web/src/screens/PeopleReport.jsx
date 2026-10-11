// Per-person summary: with whom, how many times and how many hours, by event type or by role.
import { useState } from "preact/hooks";
import { t } from "../i18n/index.js";
import { addMonths, isoDate, monthTitle } from "../lib/dates.js";
import { colorById } from "../lib/model.js";
import { formatHours, peopleStats } from "../lib/stats.js";
import { useAppState } from "../lib/store.js";
import { Icon } from "../ui/Icon.jsx";
import { Sheet } from "../ui/Sheet.jsx";
import { StatsRulesSheet } from "./settings/StatsRulesSheet.jsx";
import { EmptyState, Segmented } from "../ui/components.jsx";

export function PeopleReport({ ym, onClose, initial = "month" }) {
  const state = useAppState();
  const [period, setPeriod] = useState(ym ? initial : "all");
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState("type");
  const [showRules, setShowRules] = useState(false);
  let from = null;
  let to = null;
  let label = t("people.report.sinceStart");
  if (period === "month" && ym) {
    const next = addMonths(ym.y, ym.m, 1);
    from = isoDate(ym.y, ym.m, 1);
    to = isoDate(next.y, next.m, 1);
    label = monthTitle(ym.y, ym.m);
  } else if (period === "year" && ym) {
    from = isoDate(ym.y, 1, 1);
    to = isoDate(ym.y + 1, 1, 1);
    label = String(ym.y);
  }
  const people = peopleStats(state, { from, to });
  const periods = [
    ...(ym
      ? [
          { v: "month", label: t("people.report.month") },
          { v: "year", label: t("people.report.year") },
        ]
      : []),
    { v: "all", label: t("people.report.all") },
  ];
  const max = people[0]?.min || 0;
  return (
    <Sheet
      onClose={onClose}
      title={t("summary.perPerson")}
      subtitle={`${label} · ${t("people.report.count", { n: people.length })}`}
    >
      <Segmented value={period} onChange={setPeriod} options={periods} />
      <div class="blk">
        <div class="cap">{t("people.report.detailBy")}</div>
        <Segmented
          value={detail}
          onChange={setDetail}
          options={[
            { v: "type", label: t("people.report.byType") },
            { v: "role", label: t("people.report.byRole") },
          ]}
        />
      </div>
      {people.length === 0 && (
        <EmptyState icon="users" title={t("people.report.empty")} text={t("people.report.emptyHint")} />
      )}
      <div class="stack">
        {people.map((person) => {
          const isOpen = open === person.name;
          const width = max ? Math.round((person.min / max) * 100) : 0;
          return (
            <div class={`bil-p ${isOpen ? "on" : ""}`} key={person.name}>
              <button
                type="button"
                class="bil-h"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : person.name)}
              >
                <span class="bil-n">{person.name}</span>
                <span class="bil-v">{t("people.report.line", { n: person.n, hours: formatHours(person.min) })}</span>
                <Icon n={isOpen ? "chevU" : "chevD"} size={16} />
                <i class="bil-bar" style={{ "--w": `${width}%` }} />
              </button>
              {isOpen && (
                <div class="bil-d">
                  {(detail === "type" ? person.types : person.roles).map((row) => (
                    <div class="bil-r" key={row.id}>
                      {detail === "type" && <i class="dot" style={{ background: colorById(row.color).hex }} />}
                      <span>{row.label}</span>
                      <b>{row.n}×</b>
                      <span class="muted">{row.min ? formatHours(row.min) : t("people.report.noHours")}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p class="muted small">
        {t("people.report.footer")}{" "}
        <button type="button" class="link" onClick={() => setShowRules(true)}>
          {t("summary.rules")}
        </button>
      </p>
      {showRules && <StatsRulesSheet onClose={() => setShowRules(false)} />}
    </Sheet>
  );
}
