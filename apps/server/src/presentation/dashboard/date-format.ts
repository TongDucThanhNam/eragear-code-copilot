const UTC_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

export function formatUtcDateLabel(date = new Date()): string {
  return `${UTC_DATE_FORMATTER.format(date)} UTC`;
}
