export function formatQuotaReset(
  value: string,
  nowMs: number = Date.now()
): string {
  const resetMs = Date.parse(value);
  if (Number.isNaN(resetMs)) {
    return "Reset time unavailable";
  }

  const remainingMs = resetMs - nowMs;
  if (remainingMs <= 0) {
    return "Reset due";
  }

  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0 && days === 0) {
    parts.push(`${minutes}m`);
  }

  return `Resets in ${parts.join(" ")}`;
}
