// iCalendar export (.ics, RFC 5545): one file per colour, per type, or a single file. Every event
// keeps a stable UID, so re-importing a file updates the events instead of duplicating them.
import { compactDate } from "./dates.js";
import { TIMEZONES, colorById, findType } from "./model.js";
import { eventDescription, eventTitle } from "./templates.js";
import { eventTiming } from "./timing.js";

const utf8 = new TextEncoder();

function icsEscape(text) {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

function icsFold(line) {
  if (utf8.encode(line).length <= 75) {
    return line;
  }
  const parts = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const size = utf8.encode(ch).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = " " + ch;
      bytes = 1 + size;
      limit = 75;
    } else {
      current += ch;
      bytes += size;
    }
  }
  parts.push(current);
  return parts.join(`\r\n`);
}

const utcOffset = (minutes) => {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}${String(abs % 60).padStart(2, "0")}`;
};

// Daylight-saving transitions, as local wall-clock times of the period being left.
const DST_RULES = {
  // Last Sunday of March / October at 01:00 UTC.
  eu: (tz) => ({
    toDst: { month: 3, byday: "-1SU", day: 29, hour: 1 + tz.std / 60 },
    toStd: { month: 10, byday: "-1SU", day: 25, hour: 1 + tz.dst / 60 },
  }),
  // Second Sunday of March / first Sunday of November at 02:00 local time.
  us: () => ({
    toDst: { month: 3, byday: "2SU", day: 8, hour: 2 },
    toStd: { month: 11, byday: "1SU", day: 1, hour: 2 },
  }),
};

const pad = (n) => String(n).padStart(2, "0");

/** VTIMEZONE block describing `tzId`, or nothing for floating times. */
function vtimezone(tzId) {
  const tz = TIMEZONES.find((z) => z.id === tzId);
  if (!tz || tz.id === "floating") {
    return [];
  }
  const lines = ["BEGIN:VTIMEZONE", `TZID:${tz.id}`];
  const rule = tz.dst != null && DST_RULES[tz.rule]?.(tz);
  if (rule) {
    const [stdName, dstName] = tz.names;
    const at = (r) => `1970${pad(r.month)}${pad(r.day)}T${pad(r.hour)}0000`;
    lines.push(
      "BEGIN:DAYLIGHT",
      `TZOFFSETFROM:${utcOffset(tz.std)}`,
      `TZOFFSETTO:${utcOffset(tz.dst)}`,
      `TZNAME:${dstName}`,
      `DTSTART:${at(rule.toDst)}`,
      `RRULE:FREQ=YEARLY;BYMONTH=${rule.toDst.month};BYDAY=${rule.toDst.byday}`,
      "END:DAYLIGHT",
      "BEGIN:STANDARD",
      `TZOFFSETFROM:${utcOffset(tz.dst)}`,
      `TZOFFSETTO:${utcOffset(tz.std)}`,
      `TZNAME:${stdName}`,
      `DTSTART:${at(rule.toStd)}`,
      `RRULE:FREQ=YEARLY;BYMONTH=${rule.toStd.month};BYDAY=${rule.toStd.byday}`,
      "END:STANDARD",
    );
  } else {
    lines.push(
      "BEGIN:STANDARD",
      `TZOFFSETFROM:${utcOffset(tz.std)}`,
      `TZOFFSETTO:${utcOffset(tz.std)}`,
      `TZNAME:${tz.names?.[0] || tz.id.split("/")[1]}`,
      "DTSTART:19700101T000000",
      "END:STANDARD",
    );
  }
  lines.push("END:VTIMEZONE");
  return lines;
}

const icsTimestamp = (date) =>
  `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}T${String(date.getUTCHours()).padStart(2, "0")}${String(date.getUTCMinutes()).padStart(2, "0")}${String(date.getUTCSeconds()).padStart(2, "0")}Z`;

const icsTime = (time) => time.replace(":", "") + "00";

function icsEvent(state, ev, { tzId, now }) {
  const timing = eventTiming(state, ev);
  const type = findType(state, ev.typeId);
  if (!timing || !type) {
    return [];
  }
  const lines = [
    "BEGIN:VEVENT",
    // Historical UID domain: changing it would duplicate events already imported.
    `UID:${ev.id}@pam-agenda`,
    `DTSTAMP:${icsTimestamp(now)}`,
    `SEQUENCE:${ev.seq || 0}`,
  ];
  if (timing.allDay) {
    lines.push(
      `DTSTART;VALUE=DATE:${compactDate(timing.startDate)}`,
      `DTEND;VALUE=DATE:${compactDate(timing.endDate)}`,
      "TRANSP:TRANSPARENT",
    );
  } else {
    const tz = tzId && tzId !== "floating" ? `;TZID=${tzId}` : "";
    lines.push(
      `DTSTART${tz}:${compactDate(timing.startDate)}T${icsTime(timing.startTime)}`,
      `DTEND${tz}:${compactDate(timing.endDate)}T${icsTime(timing.endTime)}`,
      "TRANSP:OPAQUE",
    );
  }
  lines.push(`SUMMARY:${icsEscape(eventTitle(state, ev))}`);
  const description = eventDescription(state, ev);
  if (description) {
    lines.push(`DESCRIPTION:${icsEscape(description)}`);
  }
  if (type.location) {
    lines.push(`LOCATION:${icsEscape(type.location)}`);
  }
  lines.push(`CATEGORIES:${icsEscape(type.name)}`, "STATUS:CONFIRMED");
  for (const minutes of type.alarms || []) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsEscape(eventTitle(state, ev))}`,
      `TRIGGER:-PT${Math.round(minutes)}M`,
      "END:VALARM",
    );
  }
  lines.push("END:VEVENT");
  return lines;
}

/** Complete .ics file for `events`. */
export function buildIcs(
  state,
  events,
  { calName = "AgendApp", tzId = state.settings.tz, now = new Date() } = {},
) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AgendApp//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(calName)}`,
  ];
  if (tzId && tzId !== "floating") {
    lines.push(`X-WR-TIMEZONE:${tzId}`);
  }
  lines.push(...vtimezone(tzId));
  for (const ev of events) {
    lines.push(...icsEvent(state, ev, { tzId, now }));
  }
  lines.push("END:VCALENDAR");
  return lines.map(icsFold).join(`\r\n`) + `\r\n`;
}

/** File-name-safe version of a name: "Night shift" → "night-shift". */
export const fileSlug = (text) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "agenda";

/**
 * Splits `events` into the files to export: grouping "single", "perType" or "perColor"
 * (Google Calendar colours imported events after the calendar they land in).
 */
export function exportFiles(state, events, grouping, calName) {
  const valid = events.filter((ev) => findType(state, ev.typeId));
  if (grouping === "single") {
    return [
      {
        key: "all",
        label: calName,
        calName,
        color: null,
        events: valid,
        filename: `${fileSlug(calName)}.ics`,
      },
    ];
  }
  const groups = new Map();
  for (const ev of valid) {
    const type = findType(state, ev.typeId);
    const key = grouping === "perType" ? type.id : type.color;
    if (!groups.has(key)) {
      groups.set(key, { key, types: new Set(), events: [] });
    }
    const group = groups.get(key);
    group.types.add(type.name);
    group.events.push(ev);
  }
  return [...groups.values()].map((group) => {
    const color =
      grouping === "perType"
        ? colorById(findType(state, group.events[0].typeId).color)
        : colorById(group.key);
    const typeNames = [...group.types].join(" + ");
    const label =
      grouping === "perType" ? `${calName} – ${typeNames}` : `${calName} – ${color.name} (${typeNames})`;
    return {
      key: group.key,
      label,
      calName: label,
      color,
      events: group.events,
      filename: `${fileSlug(calName)}-${fileSlug(grouping === "perType" ? typeNames : color.name)}.ics`,
    };
  });
}
