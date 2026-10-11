// Monthly summary under the calendar: worked hours, nights, days off and the number of events per
// type, following the hours summary rules.
import { useState } from "preact/hooks";
import { t } from "../i18n/index.js";
import { addMonths, isoDate } from "../lib/dates.js";
import { colorById } from "../lib/model.js";
import { periodTotals, totalsLine } from "../lib/stats.js";
import { Icon } from "../ui/Icon.jsx";
import { PeopleReport } from "./PeopleReport.jsx";
import { StatsRulesSheet } from "./settings/StatsRulesSheet.jsx";

export function MonthSummary({ state, ym }) {
  const [showPeople, setShowPeople] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const next = addMonths(ym.y, ym.m, 1);
  const totals = periodTotals(state, isoDate(ym.y, ym.m, 1), isoDate(next.y, next.m, 1));
  if (!totals.byType.size) {
    return null;
  }
  return (
    <section class="bilan">
      <header>
        <h2>{t("summary.title")}</h2>
        <span class="muted small">{totalsLine(totals)}</span>
      </header>
      <div class="chips tight">
        {[...totals.byType.values()].map((entry) => (
          <span class="chip sm static" style={{ "--c": colorById(entry.t.color).hex }} key={entry.t.id}>
            <i class="dot" />
            {entry.t.name}{" "}
            <b>{entry.unit === "days" ? t("summary.daysShort", { n: entry.n }) : entry.n}</b>
          </span>
        ))}
      </div>
      <button type="button" class="link bil-link" onClick={() => setShowPeople(true)}>
        <Icon n="users" size={15} /> {t("summary.perPerson")}
      </button>
      <button type="button" class="link bil-link" onClick={() => setShowRules(true)}>
        <Icon n="gear" size={15} /> {t("summary.rules")}
      </button>
      {showPeople && <PeopleReport ym={ym} onClose={() => setShowPeople(false)} />}
      {showRules && <StatsRulesSheet onClose={() => setShowRules(false)} />}
    </section>
  );
}
