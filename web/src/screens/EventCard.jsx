// Event card (day list, schedule): title, times, filled fields, warnings and export status.
import { t } from "../i18n/index.js";
import { colorById, findType } from "../lib/model.js";
import { eventFieldsSummary, eventTitle } from "../lib/templates.js";
import { slotLabel } from "../lib/timing.js";
import { Badge, contrastText } from "../ui/components.jsx";

export function EventCard({ state, event: ev, issue, onClick, showDate }) {
  const type = findType(state, ev.typeId);
  const color = colorById(type?.color).hex;
  const toReview = Object.keys(ev.review || {}).length > 0;
  const summary = eventFieldsSummary(state, ev);
  return (
    <button
      type="button"
      class="ecard"
      style={{ "--c": color, "--ct": contrastText(color) }}
      onClick={onClick}
    >
      <i class="ecard-bar" />
      <span class="ecard-m">
        <strong>{eventTitle(state, ev)}</strong>
        <small>
          {showDate && `${ev.date.slice(8)}/${ev.date.slice(5, 7)} · `}
          {type?.kind === "allday"
            ? t("event.allDayLength", { n: ev.days || type.days })
            : slotLabel(state, type, ev.slotId)}
        </small>
        {summary && <small class="ecard-v">{summary}</small>}
      </span>
      <span class="ecard-r">
        {issue?.some((it) => it.level === "error") && (
          <Badge tone="danger" icon="alert">
            {t("event.error")}
          </Badge>
        )}
        {issue?.some((it) => it.level === "warn") && (
          <Badge tone="warn" icon="alert">
            {issue.find((it) => it.level === "warn").text}
          </Badge>
        )}
        {toReview && (
          <Badge tone="info" icon="eye">
            {t("event.toReview")}
          </Badge>
        )}
        {ev.status === "exported" && (
          <Badge tone="ok" icon="check">
            {t("event.exported")}
          </Badge>
        )}
      </span>
    </button>
  );
}
