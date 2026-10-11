// Calendar dates as "YYYY-MM-DD" strings (sortable and comparable as text) and their display
// formats. Day arithmetic goes through UTC so that daylight-saving changes never shift a date.
import { t, tList } from "../i18n/index.js";

const pad2 = (n) => String(n).padStart(2, "0");

export const isoDate = (year, month, day) => `${year}-${pad2(month)}-${pad2(day)}`;

export function parseIso(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return { y: year, m: month, d: day };
}

const isoToUtc = (iso) => {
  const { y, m, d } = parseIso(iso);
  return new Date(Date.UTC(y, m - 1, d));
};

const utcToIso = (date) => isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());

export function addDays(iso, days) {
  const date = isoToUtc(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return utcToIso(date);
}

export const daysBetween = (from, to) => Math.round((isoToUtc(to) - isoToUtc(from)) / 86_400_000);

/** Day of the week, 0 = Monday … 6 = Sunday. */
export const weekdayIndex = (iso) => (isoToUtc(iso).getUTCDay() + 6) % 7;

export const weekStart = (iso) => addDays(iso, -weekdayIndex(iso));

export function todayIso() {
  const now = new Date();
  return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export const compactDate = (iso) => iso.replace(/-/g, "");

/** Every day from `from` to `to` inclusive (either order). */
export function dateRange(from, to) {
  if (from > to) {
    [from, to] = [to, from];
  }
  const days = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}

/** Month shifted by `delta`: { y, m }. */
export function addMonths(year, month, delta) {
  const index = year * 12 + (month - 1) + delta;
  return { y: Math.floor(index / 12), m: (index % 12) + 1 };
}

/** Weeks (Monday → Sunday) covering the month, for the calendar grid. */
export function monthGrid(year, month) {
  const first = isoDate(year, month, 1);
  const gridStart = weekStart(first);
  const next = addMonths(year, month, 1);
  const last = addDays(isoDate(next.y, next.m, 1), -1);
  const gridEnd = addDays(weekStart(last), 6);
  const weeks = [];
  for (let monday = gridStart; monday <= gridEnd; monday = addDays(monday, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, offset) => addDays(monday, offset)));
  }
  return weeks;
}

/** Month name, 1 = January. */
export const monthName = (month) => tList("date.months")[month - 1];

/** "October 2026" (capitalised, for titles). */
export function monthTitle(year, month) {
  const name = monthName(month);
  return `${name[0].toUpperCase()}${name.slice(1)} ${year}`;
}

/** Short weekday names, Monday first. */
export const weekdaysShort = () => tList("date.weekdaysShort");

/** One-letter weekday headings, Monday first. */
export const weekdayLetters = () => tList("date.weekdayLetters");

/** "Mon 3 Oct" */
export function formatDateShort(iso) {
  const { m, d } = parseIso(iso);
  return t("date.short", {
    wd: weekdaysShort()[weekdayIndex(iso)],
    d,
    mon: tList("date.monthsShort")[m - 1],
  });
}

/** "Monday 1 October 2026" */
export function formatDateLong(iso) {
  const { y, m, d } = parseIso(iso);
  return t("date.long", { wd: tList("date.weekdays")[weekdayIndex(iso)], d, mon: monthName(m), y });
}

export const timeToMinutes = (time) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

/** "08:30" → "8:30" (English) or "8h30" (French). */
export function formatTime(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return t("date.time", { h: hours, m: pad2(minutes) });
}

/** Groups dates into runs of consecutive days: [[1, 2, 3], [5]]. */
export function groupConsecutive(dates) {
  const sorted = [...new Set(dates)].sort();
  const runs = [];
  for (const date of sorted) {
    const run = runs[runs.length - 1];
    if (run && addDays(run[run.length - 1], 1) === date) {
      run.push(date);
    } else {
      runs.push([date]);
    }
  }
  return runs;
}

/** "Mon 3 Oct → Wed 5 Oct, Fri 7 Oct" (at most three runs, then "+n"). */
export function formatDateList(dates) {
  const parts = groupConsecutive(dates).map((run) =>
    run.length === 1
      ? formatDateShort(run[0])
      : `${formatDateShort(run[0])} → ${formatDateShort(run[run.length - 1])}`,
  );
  return parts.length > 3 ? `${parts.slice(0, 3).join(", ")} +${parts.length - 3}` : parts.join(", ");
}
