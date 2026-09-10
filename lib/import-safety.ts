import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ImportResult = { status: "success" | "duplicate" | "error"; message: string };
export class ImportProblem extends Error {}

type ImportCollection = {
  id: string;
  code: string;
  title: string;
  created_by: string;
  status: string;
  review_status: string;
};

export function importCode(workspaceId: string, fingerprint: string) {
  // Existing UNIQUE(created_by, code) makes same-account concurrent retries safe.
  return `csv-${createHash("sha256").update(`${workspaceId}:${fingerprint}`).digest("hex")}`;
}

export function importFailure(error: unknown): ImportResult {
  console.error("[resource-import] failed", error);
  if (error instanceof ImportProblem) return { status: "error", message: error.message };
  const message = error instanceof Error ? error.message : String(error);
  if (/请先登录|JWT|Refresh Token/i.test(message)) return { status: "error", message: "登录状态已失效，请重新登录后再导入。" };
  if (/fetch|network|timeout/i.test(message)) return { status: "error", message: "导入结果暂时无法确认，请检查网络后用同一份文件重试，系统会检查已有内容。" };
  return { status: "error", message: "导入暂未完成，请用同一份文件重试；若仍失败，请让管理员检查服务端导入日志。" };
}

export function checkImportWrite(error: { code?: string; message: string } | null, context: string) {
  if (!error) return;
  console.error("[resource-import] database write failed", { context, ...error });
  throw new ImportProblem(`${context}。本次内容暂未全部完成，请用同一份文件重试，系统会继续检查已有内容。`);
}

export async function prepareImportCollection(input: {
  supabase: SupabaseClient;
  table: "content_packages" | "poem_collections" | "catechism_collections";
  itemTable: "package_characters" | "poem_collection_items" | "catechism_items";
  itemForeignKey: "package_id" | "collection_id";
  workspaceId: string;
  userId: string;
  fingerprint: string;
  legacyFingerprint: string;
  expectedCount: number;
  values: Record<string, unknown>;
}) {
  const { supabase, table, itemTable, itemForeignKey, workspaceId, userId, fingerprint, expectedCount } = input;
  const code = importCode(workspaceId, fingerprint);
  const fields = "id,code,title,created_by,status,review_status";
  // Only inspect rows visible through the current user's RLS; never use a service key.
  const { data: matches, error: matchError } = await supabase.from(table).select(fields)
    .eq("workspace_id", workspaceId).in("fingerprint", [...new Set([fingerprint, input.legacyFingerprint])])
    .order("created_at").limit(30);
  checkImportWrite(matchError, "检查已导入资源失败");
  let collection = (matches as ImportCollection[] | null)?.find((row) => row.status === "published" && row.review_status === "approved")
    ?? (matches as ImportCollection[] | null)?.find((row) => row.created_by === userId)
    ?? (matches as ImportCollection[] | null)?.[0];
  let created = false;
  if (!collection) {
    const { data, error } = await supabase.from(table).insert({
      ...input.values, created_by: userId, workspace_id: workspaceId, code, fingerprint,
      // Publish only after all items exist, so an interrupted upload never exposes an empty book.
      status: "draft", review_status: "draft", approved_by: null, approved_at: null,
    }).select(fields).single();
    if (error?.code === "23505") {
      const { data: winner, error: winnerError } = await supabase.from(table).select(fields)
        .eq("workspace_id", workspaceId).eq("created_by", userId).eq("code", code).single();
      checkImportWrite(winnerError, "检查正在导入的资源失败");
      collection = winner as ImportCollection;
    } else {
      checkImportWrite(error, "创建导入草稿失败");
      collection = data as ImportCollection;
      created = true;
    }
  }
  if (!collection) throw new ImportProblem("未能确认资源的导入状态，请稍后重试。");
  const { count, error: countError } = await supabase.from(itemTable).select("*", { count: "exact", head: true })
    .eq(itemForeignKey, collection.id);
  checkImportWrite(countError, "检查资源完整性失败");
  const complete = count === expectedCount;
  const resumable = collection.created_by === userId && collection.code === code
    && collection.status === "draft" && collection.review_status === "draft";
  if (!complete && !resumable) {
    throw new ImportProblem(`已有同内容资源“${collection.title}”，但目录不完整。请管理员在资源管理中检查；本次没有重复创建。`);
  }
  return { collection, created, complete, resumable };
}

export function existingImportMessage(collection: ImportCollection, assigned: boolean, noun: string) {
  if (assigned) return `相同内容已存在于“${collection.title}”，已为所选孩子确认分配，无需重复导入${noun}。`;
  if (collection.status === "archived") return `相同内容已存在于已归档的“${collection.title}”。请管理员在资源管理中恢复并分配，无需重复导入。`;
  if (collection.status !== "published" || collection.review_status !== "approved") return `相同内容已存在于“${collection.title}”，尚待发布或审核，请在资源管理中继续处理，无需重复导入。`;
  return `相同内容已存在于“${collection.title}”。请管理员将它分配给所选孩子，无需重复导入。`;
}

export async function finishImportCollection(supabase: SupabaseClient, table: string, collection: ImportCollection, isAdmin: boolean, publish: boolean, userId: string) {
  const { data, error } = await supabase.from(table).update({
    status: publish ? "published" : "draft",
    review_status: isAdmin ? "approved" : "pending_review",
    approved_by: isAdmin ? userId : null,
    approved_at: isAdmin ? new Date().toISOString() : null,
  }).eq("id", collection.id).eq("created_by", userId).eq("status", "draft").eq("review_status", "draft")
    .select("id,code,title,created_by,status,review_status").maybeSingle();
  checkImportWrite(error, "内容已保存，但提交审核或发布失败");
  if (data) return data as ImportCollection;
  const { data: current, error: currentError } = await supabase.from(table)
    .select("id,code,title,created_by,status,review_status").eq("id", collection.id).single();
  checkImportWrite(currentError, "内容已保存，但确认发布状态失败");
  if (!current) throw new ImportProblem("内容已保存，暂时无法确认发布状态，请刷新资源管理页。");
  return current as ImportCollection;
}
