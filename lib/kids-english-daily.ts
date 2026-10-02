export type KidsEnglishDailySettings = {
  daily_new_limit: number;
  pending_daily_new_limit: number | null;
  pending_effective_on: string | null;
};

export function localDateForTimeZone(timeZone: string, now = new Date()) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now);
  }
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "00";
  return [part("year"), part("month"), part("day")].join("-");
}

export function effectiveKidsEnglishDailySettings(settings: KidsEnglishDailySettings | null, today: string) {
  const current = settings?.daily_new_limit ?? 3;
  const pending = settings?.pending_daily_new_limit;
  const effectiveOn = settings?.pending_effective_on;
  if (pending != null && effectiveOn && effectiveOn <= today) {
    return { todayLimit: pending, upcomingLimit: null, upcomingOn: null };
  }
  return {
    todayLimit: current,
    upcomingLimit: pending ?? null,
    upcomingOn: effectiveOn ?? null,
  };
}
