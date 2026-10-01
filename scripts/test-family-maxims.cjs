/* eslint-disable @typescript-eslint/no-require-imports -- Standalone CommonJS smoke test. */
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

async function main() {
  const { makeDailyMaximQueue } = await import(pathToFileURL(path.join(__dirname,"../lib/family-maxims.ts")).href);
  const base = { text_zh:"耐心",text_en:"Patience",source_title:"",source_detail:"",translation_version:"",explanation_zh:"",child_explanation_zh:"",tags:"",archived_at:null };
  const items = ["new-a","new-b","due-a","future-a"].map((id,index)=>({ ...base,id,created_at:`2026-09-0${index+1}T00:00:00Z` }));
  const states = [
    { maxim_id:"due-a",language:"zh",stage:2,due_on:"2026-10-01",total_attempts:2,independent_days:2,last_result:"independent" },
    { maxim_id:"future-a",language:"zh",stage:2,due_on:"2026-10-10",total_attempts:2,independent_days:2,last_result:"independent" },
    { maxim_id:"due-a",language:"en",stage:1,due_on:"2026-10-10",total_attempts:1,independent_days:1,last_result:"independent" },
  ];
  const empty = new Map();
  const today="2026-10-01";
  const first=makeDailyMaximQueue(items,states,[],"zh",today,1,3,empty);
  assert.deepEqual(first.map((x)=>x.id),["due-a","new-a"]);
  assert.equal(first[0].queueKind,"review");
  assert.equal(first[1].queueKind,"new");
  const practiced=[{maxim_id:"new-a",language:"zh",stage_before:0,practiced_local_date:today}];
  assert.deepEqual(makeDailyMaximQueue(items,states,practiced,"zh",today,1,3,empty).map((x)=>x.id),["due-a"]);
  assert.deepEqual(makeDailyMaximQueue(items,states,practiced,"en",today,1,3,empty).map((x)=>x.id),["new-a"]);
  console.log("家中箴言：队列优先级、当日新句限额、中英文隔离测试通过");
}
main().catch((error)=>{ console.error(error);process.exitCode=1; });
