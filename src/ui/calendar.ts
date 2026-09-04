/**
 * Google Calendar event-creation links (§38).
 *
 * Manual only — no OAuth, Calendar API, or event-id management. The app
 * stays the source of truth; the calendar is a reminder channel. The user
 * configures the alarm/reminder themselves.
 *
 * URL format (Google Calendar "event template" link):
 *   https://calendar.google.com/calendar/render?action=TEMPLATE&text=…&dates=…&details=…
 */

const CALENDAR_BASE = "https://calendar.google.com/calendar/render";

export interface CalendarEventLink {
  /** Event title, e.g. the maintenance item name. */
  title: string;
  /** ISO date "yyyy-mm-dd" the event starts on (due/estimated date). */
  date: string;
  /** Optional multi-line description. */
  details?: string;
  /** Optional all-day flag (default true — a maintenance due date is a day,
   * not a time slot). */
  allDay?: boolean;
}

/**
 * Builds an event-creation URL. All-day events span `date` → `date+1`
 * (Google's `dates` range end is exclusive). `text`/`details` are
 * URL-encoded; `dates` keeps its literal slash (Google expects
 * `YYYYMMDD/YYYYMMDD` unescaped).
 */
export function googleCalendarUrl(event: CalendarEventLink): string {
  const start = isoToGoogleDate(event.date);
  const dateParam =
    event.allDay === false
      ? `${start}T090000/${start}T100000` // fixed 1-hour morning slot
      : `${start}/${isoToGoogleDate(dayAfterIso(event.date))}`;

  const params: string[] = [`action=TEMPLATE`, `text=${encodeURIComponent(event.title)}`, `dates=${dateParam}`];
  if (event.details) params.push(`details=${encodeURIComponent(event.details)}`);
  return `${CALENDAR_BASE}?${params.join("&")}`;
}

/** "yyyy-mm-dd" → "YYYYMMDD" (calendar render format). */
export function isoToGoogleDate(iso: string): string {
  return iso.replaceAll("-", "");
}

/** Returns the ISO date one day after the given one (end of an all-day
 * event is exclusive in Google's format). */
export function dayAfterIso(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day) + 86_400_000);
  return next.toISOString().slice(0, 10);
}
