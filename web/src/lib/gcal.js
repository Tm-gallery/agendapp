// Direct sending to a calendar: event payloads in the shape expected by a "Google Calendar"
// connector (create_event / update_event tools). In the Android app this connector is served
// locally by the phone's calendar (see platform/android/bridge.js and CalendarSync.kt).
import { addDays } from "./dates.js";
import { findType } from "./model.js";
import { eventDescription, eventTitle } from "./templates.js";
import { eventTiming } from "./timing.js";

/** Calendars found anywhere in a list_calendars response: [{ id, name, primary }]. */
export function parseCalendarList(payload) {
  const calendars = [];
  const seen = new Set();
  const visit = (node) => {
    if (node) {
      if (typeof node == "string") {
        try {
          visit(JSON.parse(node));
        } catch {}
        return;
      }
      if (Array.isArray(node)) {
        return node.forEach(visit);
      }
      if (typeof node == "object") {
        const id = node.id || node.calendarId;
        const name = node.summaryOverride || node.summary || node.name || node.title;
        if (id && name && !seen.has(id)) {
          seen.add(id);
          calendars.push({ id: String(id), name: String(name), primary: !!node.primary });
        }
        Object.values(node).forEach((child) => typeof child == "object" && visit(child));
      }
    }
  };
  visit(payload);
  return calendars;
}

/** Connector payload for one event, or null if its type or slot no longer exists. */
export function gcalEventPayload(state, ev, { calendarId, allDayEndExclusive = true } = {}) {
  const timing = eventTiming(state, ev);
  const type = findType(state, ev.typeId);
  if (!timing || !type) {
    return null;
  }
  const payload = { summary: eventTitle(state, ev), colorId: type.color };
  if (calendarId) {
    payload.calendarId = calendarId;
  }
  const description = eventDescription(state, ev);
  if (description) {
    payload.description = description;
  }
  if (type.location) {
    payload.location = type.location;
  }
  if (timing.allDay) {
    payload.allDay = true;
    payload.startTime = `${timing.startDate}T00:00:00`;
    payload.endTime = `${allDayEndExclusive ? timing.endDate : addDays(timing.endDate, -1)}T00:00:00`;
    payload.availability = "AVAILABILITY_FREE";
  } else {
    payload.startTime = `${timing.startDate}T${timing.startTime}:00`;
    payload.endTime = `${timing.endDate}T${timing.endTime}:00`;
    payload.availability = "AVAILABILITY_BUSY";
  }
  if (state.settings.tz && state.settings.tz !== "floating") {
    payload.timeZone = state.settings.tz;
  }
  if (type.alarms?.length) {
    payload.useDefaultReminders = false;
    payload.overrideReminders = type.alarms.map((alarm) => ({ method: "popup", minutes: Math.round(alarm) }));
  }
  return payload;
}

/** Id of the created event, whatever the shape of the connector's answer. */
export function createdEventId(result) {
  if (!result) {
    return null;
  }
  if (typeof result == "string") {
    const match = result.match(/"id"\s*:\s*"([^"]+)"/) || result.match(/\bid[:=]\s*([A-Za-z0-9_]{10,})/);
    return match ? match[1] : null;
  }
  if (typeof result == "object") {
    if (result.id) {
      return String(result.id);
    }
    if (result.event?.id) {
      return String(result.event.id);
    }
    if (result.eventId) {
      return String(result.eventId);
    }
  }
  return null;
}

export const GCAL_SERVER = "Google Calendar";
