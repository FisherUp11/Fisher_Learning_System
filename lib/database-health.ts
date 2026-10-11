import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertOwner, loadAccessContext } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DatabaseHealth } from "@/lib/database-health-values";

export async function loadDatabaseHealth(db:SupabaseClient,userId:string):Promise<DatabaseHealth> {
  // Privileged key is used only AFTER live workspace role authorization, never JWT user_metadata.
  const access=await loadAccessContext(db,userId);assertOwner(access);
  const {data,error}=await createAdminClient().rpc("owner_database_health",{p_workspace_id:access.workspaceId,p_user_id:userId});
  if(error) throw new Error("容量报表未就绪。请确认已运行 036 SQL，并检查同项目的服务端 Supabase Secret key 与 owner 权限。");
  if(!data || !Array.isArray(data.tables) || !Array.isArray(data.history) || !Number.isFinite(data.clusterDatabaseBytes) || !Number.isFinite(data.databaseBytes) || !Number.isFinite(Date.parse(data.capturedAt))) throw new Error("数据库容量数据格式异常，请稍后刷新；不能把读取失败当成零用量。");
  return {...data,stale:Date.now()-Date.parse(data.capturedAt)>15*60000} as DatabaseHealth;
}
