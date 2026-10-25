const QUIET_END_HOUR = 8;
const QUIET_START_HOUR = 21;

export function isQuietHours(now: Date, timeZone: string | null | undefined): boolean {
  const zone = timeZone?.trim();
  if (!zone) return true;
  const clockZone = zone === "China/Shanghai" ? "Asia/Shanghai" : zone;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: clockZone,
      hour: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "") % 24;
    if (Number.isNaN(hour)) return true;
    return hour < QUIET_END_HOUR || hour >= QUIET_START_HOUR;
  } catch {
    return true;
  }
}
