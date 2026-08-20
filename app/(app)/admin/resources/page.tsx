import { redirect } from "next/navigation";
import { reviewWorkspaceResource } from "@/lib/admin-actions";
import { loadAccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { DuplicateResourceCleanup } from "@/components/duplicate-resource-cleanup";

export const dynamic = "force-dynamic";

type Resource = { id: string; title: string; status: string; review_status: string; created_at: string; submitted_for_learner_id: string | null; fingerprint: string | null; kind: "hanzi" | "poem" | "music" | "catechism"; preview: string };
const labels = { hanzi: "汉字册", poem: "诗词册", music: "音乐", catechism: "问答册" } as const;
const musicLabels: Record<string, string> = { song: "唱一唱", instrument: "辨声音", rhythm: "打节奏" };

function relationValue(value: unknown, key: string) {
  const relation = Array.isArray(value) ? value[0] : value;
  return relation && typeof relation === "object" ? String((relation as Record<string, unknown>)[key] ?? "") : "";
}

function makePreviewMap(rows: Array<Record<string, unknown>>, ownerKey: string, relationKey: string, valueKey: string) {
  const grouped = new Map<string, string[]>();
  for (const row of rows) {
    const ownerId = String(row[ownerKey] ?? "");
    const value = relationValue(row[relationKey], valueKey);
    if (!ownerId || !value) continue;
    grouped.set(ownerId, [...(grouped.get(ownerId) ?? []), value]);
  }
  return new Map([...grouped].map(([id, values]) => [id, `${values.length} 条 · ${values.slice(0, 6).join("、")}${values.length > 6 ? "…" : ""}`]));
}

export default async function AdminResourcesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const access = await loadAccessContext(supabase, user.id);
  if (!access?.isAdmin) redirect("/parent");
  const [packages, poems, music, catechism, learners, packageEntries, poemEntries, catechismEntries] = await Promise.all([
    supabase.from("content_packages").select("id,title,status,review_status,created_at,submitted_for_learner_id,fingerprint").eq("workspace_id", access.workspaceId),
    supabase.from("poem_collections").select("id,title,status,review_status,created_at,submitted_for_learner_id,fingerprint").eq("workspace_id", access.workspaceId),
    supabase.from("music_items").select("id,title,status,review_status,created_at,submitted_for_learner_id,fingerprint,item_type,category").eq("workspace_id", access.workspaceId),
    supabase.from("catechism_collections").select("id,title,status,review_status,created_at,submitted_for_learner_id,fingerprint").eq("workspace_id", access.workspaceId),
    supabase.from("learner_profiles").select("id,display_name"),
    supabase.from("package_characters").select("package_id,characters(character)"),
    supabase.from("poem_collection_items").select("collection_id,poems(title)"),
    supabase.from("catechism_items").select("collection_id,question_zh"),
  ]);
  const learnerNames = new Map((learners.data ?? []).map((learner) => [learner.id, learner.display_name]));
  const packagePreviews = makePreviewMap((packageEntries.data ?? []) as Array<Record<string, unknown>>, "package_id", "characters", "character");
  const poemPreviews = makePreviewMap((poemEntries.data ?? []) as Array<Record<string, unknown>>, "collection_id", "poems", "title");
  const catechismPreviews = new Map<string, string[]>();
  for (const row of (catechismEntries.data ?? [])) {
    const values = catechismPreviews.get(row.collection_id) ?? [];
    values.push(String(row.question_zh ?? ""));
    catechismPreviews.set(row.collection_id, values);
  }
  const resources: Resource[] = [
    ...(packages.data ?? []).map((row) => ({ ...row, kind: "hanzi" as const, preview: packagePreviews.get(row.id) ?? "0 个汉字" })),
    ...(poems.data ?? []).map((row) => ({ ...row, kind: "poem" as const, preview: poemPreviews.get(row.id) ?? "0 首诗词" })),
    ...(music.data ?? []).map((row) => ({ ...row, kind: "music" as const, preview: `${musicLabels[row.item_type] ?? "音乐"}${row.category ? ` · ${row.category}` : ""}` })),
    ...(catechism.data ?? []).map((row) => {
      const values = (catechismPreviews.get(row.id) ?? []).filter(Boolean);
      return { ...row, kind: "catechism" as const, preview: `${values.length} 问${values.length ? ` · ${values.slice(0, 3).join("、")}${values.length > 3 ? "…" : ""}` : ""}` };
    }),
  ].sort((left, right) => right.created_at.localeCompare(left.created_at));
  const fingerprintCounts = resources.reduce((counts, resource) => {
    if (!resource.fingerprint) return counts;
    const key = `${resource.kind}:${resource.fingerprint}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());

  return <div><header className="hero"><p className="eyebrow">Resource library</p><h1>公共资源库</h1><p className="lede">审核通过才能分配。孩子的学习记录独立保留，取消分配不会删除历史。</p></header>
    <section className="panel"><div className="library-header"><div><h2>全部资源</h2><p className="library-meta">{resources.length} 份 · 待审核 {resources.filter((item) => item.review_status === "pending_review").length} 份</p></div></div>
      {!resources.length ? <p className="notice">尚无资源。管理员可在家长页导入字册和诗词，或在各内容管理页创建。</p> : <div className="admin-resource-list">{resources.map((resource) => <article key={`${resource.kind}-${resource.id}`}>
        <span className="resource-kind">{labels[resource.kind]}</span><div><h3>{resource.title}</h3><p>{resource.status === "published" ? "已发布" : resource.status === "archived" ? "已归档" : "草稿"} · {resource.review_status === "approved" ? "已通过" : resource.review_status === "rejected" ? "已退回" : "待审核"}{resource.submitted_for_learner_id ? ` · 家长建议分配给 ${learnerNames.get(resource.submitted_for_learner_id) ?? "指定孩子"}` : ""}{resource.fingerprint && (fingerprintCounts.get(`${resource.kind}:${resource.fingerprint}`) ?? 0) > 1 ? ` · 可能重复 ${fingerprintCounts.get(`${resource.kind}:${resource.fingerprint}`)} 份` : ""}</p><p className="library-meta">{resource.preview}</p></div>
        <div className="resource-action-stack"><form action={reviewWorkspaceResource} className="resource-actions"><input type="hidden" name="resource_type" value={resource.kind} /><input type="hidden" name="resource_id" value={resource.id} />
          {resource.review_status !== "approved" && <button className="primary compact" name="decision" value="approve">通过并发布</button>}
          {resource.review_status === "pending_review" && <button className="secondary compact" name="decision" value="reject">退回</button>}
          {resource.status !== "archived" && <button className="text-button danger" name="decision" value="archive">归档</button>}
        </form>{access.isOwner && resource.fingerprint && (fingerprintCounts.get(`${resource.kind}:${resource.fingerprint}`) ?? 0) > 1 && <DuplicateResourceCleanup resourceType={resource.kind} removeId={resource.id} candidates={resources.filter((candidate) => candidate.kind === resource.kind && candidate.fingerprint === resource.fingerprint && candidate.id !== resource.id && candidate.status === "published" && candidate.review_status === "approved").map((candidate) => ({ id: candidate.id, title: candidate.title }))} />}</div>
      </article>)}</div>}
    </section>
  </div>;
}
