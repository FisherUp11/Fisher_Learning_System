"use server";

import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { requireChildModule } from "@/lib/module-access";
import { readPracticeHistory } from "@/lib/practice-history";
import type { PracticeHistoryPage, PracticeKind } from "@/lib/practice-history-values";

export async function fetchPracticeHistory(kind:PracticeKind, learnerId:string, itemId:string, page:number):Promise<{data?:PracticeHistoryPage;error?:string}> {
  try {
    if(!["poem","music","catechism"].includes(kind) || !Number.isInteger(page) || page<1 || page>100000 || !/^[\da-f-]{36}$/i.test(learnerId) || !/^[\da-f-]{36}$/i.test(itemId)) throw new Error("练习记录参数不正确");
    const db=await createClient();
    const {data:{user}}=await db.auth.getUser();
    if(!user) throw new Error("请先登录后查看练习记录");
    await requireChildModule(db,await loadAccessContext(db,user.id),user.id,learnerId,kind);
    return {data:await readPracticeHistory(db,kind,learnerId,itemId,page)};
  } catch(error) { return {error:error instanceof Error?error.message:"暂时无法读取，请重试"}; }
}
