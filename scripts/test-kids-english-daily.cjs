/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS smoke test. */
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

async function main() {
  const { effectiveKidsEnglishDailySettings, localDateForTimeZone } = await import(
    pathToFileURL(path.join(__dirname, "../lib/kids-english-daily.ts")).href
  );
  assert.equal(localDateForTimeZone("Asia/Shanghai", new Date("2026-10-01T16:15:00Z")), "2026-10-02");
  assert.deepEqual(effectiveKidsEnglishDailySettings(null, "2026-10-01"), {
    todayLimit: 3, upcomingLimit: null, upcomingOn: null,
  });
  const scheduled = { daily_new_limit: 3, pending_daily_new_limit: 10, pending_effective_on: "2026-10-02" };
  assert.deepEqual(effectiveKidsEnglishDailySettings(scheduled, "2026-10-01"), {
    todayLimit: 3, upcomingLimit: 10, upcomingOn: "2026-10-02",
  });
  assert.deepEqual(effectiveKidsEnglishDailySettings(scheduled, "2026-10-02"), {
    todayLimit: 10, upcomingLimit: null, upcomingOn: null,
  });
  console.log("儿童英语：默认 3 词、次日生效和孩子时区测试通过");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
