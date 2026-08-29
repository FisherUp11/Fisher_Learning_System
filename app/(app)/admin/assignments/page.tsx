import Link from "next/link";
import { redirect } from "next/navigation";
import { toggleWorkspaceAssignment } from "@/lib/admin-actions";
import { loadAccessContext } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { displayCatechismTitle } from "@/lib/catechism";

export const dynamic = "force-dynamic";

const modules = {
  hanzi: { label: "汉字册", table: "content_packages", assignmentTable: "learner_content_packages", resourceKey: "package_id" },
  poem: { label: "诗词册", table: "poem_collections", assignmentTable: "learner_poem_collections", resourceKey: "collection_id" },
  music: { label: "音乐内容", table: "music_items", assignmentTable: "learner_music_items", resourceKey: "item_id" },
  catechism: { label: "要理问答册", table: "catechism_collections", assignmentTable: "learner_catechism_collections", resourceKey: "collection_id" },
} as const;

export default async function AdminAssignmentsPage({ searchParams }: { searchParams: Promise<{ learner?: string; module?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const access = await loadAccessContext(supabase, user.id);
  if (!access?.isAdmin) redirect("/parent");
  const { data: learners } = await supabase.from("learner_profiles").select("id,display_name,families(name)").order("created_at");
  const learner = learners?.find((row) => row.id === params.learner) ?? learners?.[0];
  const moduleKey = (params.module && params.module in modules ? params.module : "hanzi") as keyof typeof modules;
  const moduleMeta = modules[moduleKey];
  const [{ data: resources }, { data: assignmentRows }] = learner ? await Promise.all([
    supabase.from(moduleMeta.table).select("id,title,status,review_status").eq("workspace_id", access.workspaceId).eq("status", "published").eq("review_status", "approved").order("created_at"),
    supabase.from(moduleMeta.assignmentTable).select(`${moduleMeta.resourceKey},assignment_status`).eq("learner_id", learner.id),
  ]) : [{ data: [] }, { data: [] }];
  const activeIds = new Set((assignmentRows ?? []).filter((row) => row.assignment_status === "active").map((row) => String(row[moduleMeta.resourceKey as keyof typeof row])));

  return <div><header className="hero"><p className="eyebrow">Curriculum assignment</p><h1>给每个孩子安排合适的内容</h1><p className="lede">只显示已审核、已发布的资源。取消分配后不再进入学习队列，但历史不会被删除。</p></header>
    {!learner ? <section className="panel"><p className="notice">还没有孩子档案。</p></section> : <>
      <section className="assignment-picker panel"><form action="/admin/assignments"><label>选择孩子<select name="learner" defaultValue={learner.id}>{learners?.map((row) => <option value={row.id} key={row.id}>{row.display_name}</option>)}</select></label><input type="hidden" name="module" value={moduleKey} /><button className="secondary">切换</button></form>
        <nav>{Object.entries(modules).map(([key, item]) => <Link className={key === moduleKey ? "active" : ""} href={`/admin/assignments?learner=${learner.id}&module=${key}`} key={key}>{item.label}</Link>)}</nav>
      </section>
      <section className="panel"><div className="library-header"><div><h2>{learner.display_name} · {moduleMeta.label}</h2><p className="library-meta">已分配 {activeIds.size} / {resources?.length ?? 0} 份</p></div></div>
        {!resources?.length ? <p className="notice">还没有可分配的内容，请先到资源库审核并发布。</p> : <div className="assignment-list">{resources.map((resource) => {
          const active = activeIds.has(resource.id);
          const title = moduleKey === "catechism" ? displayCatechismTitle(resource.title) : resource.title;
          return <article className={active ? "assigned" : ""} key={resource.id}><span>{active ? "✓" : "○"}</span><div><h3>{title}</h3><p>{active ? "正在学习" : "尚未分配"}</p></div><form action={toggleWorkspaceAssignment}><input type="hidden" name="learner_id" value={learner.id} /><input type="hidden" name="resource_type" value={moduleKey} /><input type="hidden" name="resource_id" value={resource.id} /><input type="hidden" name="active" value={String(!active)} /><button className={active ? "secondary compact" : "primary compact"}>{active ? "取消分配" : "分配"}</button></form></article>;
        })}</div>}
      </section>
    </>}
  </div>;
}
