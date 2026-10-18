export type HanziTerm = {
  learner_id: string; mode: "permanent" | "term"; starts_on: string | null;
  valid_until: string | null; version: number;
};

export function beijingDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function lastUsableDate(exclusiveDate: string) {
  const day = new Date(`${exclusiveDate}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

/** Same clamped calendar-month arithmetic as PostgreSQL (not 30-day months). */
export function addCalendarMonths(date: string, months: number) {
  const source = new Date(`${date}T00:00:00Z`);
  const end = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + months + 1, 0));
  return new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), Math.min(source.getUTCDate(), end.getUTCDate()))).toISOString().slice(0, 10);
}

export function describeHanziTerm(term: HanziTerm | null, enabled: boolean, today = beijingDate()) {
  if (!term) return { active: false, label: "尚未设置有效期", detail: "请联系 owner 开通；已有学习记录保留。" };
  const expired = term.mode === "term" && (!term.valid_until || today >= term.valid_until);
  const future = term.mode === "term" && Boolean(term.starts_on && today < term.starts_on);
  const label = !enabled ? "已暂停" : expired ? "已到期" : future ? "尚未开始" : term.mode === "permanent" ? "长期授权" : "有效期内";
  const detail = term.mode === "permanent" ? "长期保留汉字、拼音与青蛙跳字的使用权限。" : `可用至 ${lastUsableDate(term.valid_until!)}（北京时间，含当天）；到期后记录仍然保留。`;
  return { active: enabled && !expired && !future, label, detail };
}
