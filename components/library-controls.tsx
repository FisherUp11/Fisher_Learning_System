"use client";

import { useRouter } from "next/navigation";

type LearnerChoice = { id: string; display_name: string; daily_new_limit: number; active_package_id: string | null };
export type LibraryPackageChoice = { id: string; title: string; created_at: string };

type QueryState = { learnerId: string; query: string; status: string; attempts: string; packageId?: string; page?: number };

function libraryHref({ learnerId, query, status, attempts, packageId, page = 1 }: QueryState) {
  const params = new URLSearchParams({ learner: learnerId });
  if (query) params.set("q", query);
  if (status !== "all") params.set("status", status);
  if (attempts !== "all") params.set("attempts", attempts);
  if (packageId) params.set("package", packageId);
  if (page > 1) params.set("page", String(page));
  return `/library?${params.toString()}`;
}

export function LibraryControls({ learners, learnerId, packages, packageId, query, status, attempts }: {
  learners: LearnerChoice[];
  learnerId: string;
  packages: LibraryPackageChoice[];
  packageId?: string;
  query: string;
  status: string;
  attempts: string;
}) {
  const router = useRouter();
  function switchLearner(formData: FormData) {
    const nextLearnerId = String(formData.get("learner") ?? learnerId);
    router.push(libraryHref({ learnerId: nextLearnerId, query, status, attempts }));
  }
  function applyFilters(formData: FormData) {
    router.push(libraryHref({
      learnerId,
      query: String(formData.get("q") ?? "").trim().slice(0, 60),
      status: String(formData.get("status") ?? "all"),
      attempts: String(formData.get("attempts") ?? "all"),
      packageId: String(formData.get("package") ?? "") || undefined,
    }));
  }

  return <>
    {learners.length > 1 && <form className="learner-switch" onSubmit={(event) => { event.preventDefault(); switchLearner(new FormData(event.currentTarget)); }}>
      <label>查看哪位孩子？<select name="learner" defaultValue={learnerId}>{learners.map((learner) => <option key={learner.id} value={learner.id}>{learner.display_name}</option>)}</select></label>
      <button className="secondary" type="submit">切换</button>
    </form>}
    <form className="library-filters" onSubmit={(event) => { event.preventDefault(); applyFilters(new FormData(event.currentTarget)); }}>
      <label className="library-query">搜索汉字、拼音、释义或词语<input name="q" defaultValue={query} placeholder="例如：火、huǒ、朋友" aria-label="搜索字库" /></label>
      <label>来源字册<select name="package" defaultValue={packageId ?? ""}><option value="">全部已导入字册（{packages.length} 份）</option>{packages.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label>学习状态<select name="status" defaultValue={status}><option value="all">全部</option><option value="unstarted">还没学</option><option value="learning">复习中</option><option value="learned">已学会（阶段 5+）</option><option value="stable">稳定认识</option><option value="mastered">熟练掌握</option><option value="due">现在该复习</option></select></label>
      <label>回答次数<select name="attempts" defaultValue={attempts}><option value="all">不限</option><option value="never">0 次</option><option value="1-2">1–2 次</option><option value="3-5">3–5 次</option><option value="6+">6 次以上</option></select></label>
      <button className="secondary" type="submit">筛选</button>
      {(query || status !== "all" || attempts !== "all" || packageId) && <button className="text-button" type="button" onClick={() => router.push(libraryHref({ learnerId, query: "", status: "all", attempts: "all" }))}>清除条件</button>}
    </form>
  </>;
}

export function LibraryPagination({ learnerId, query, status, attempts, packageId, page, pageCount }: QueryState & { page: number; pageCount: number }) {
  const router = useRouter();
  if (pageCount <= 1) return null;
  const goToPage = (nextPage: number) => router.push(libraryHref({ learnerId, query, status, attempts, packageId, page: nextPage }));
  return <nav className="library-pagination" aria-label="字库分页">
    <button className="secondary" type="button" disabled={page <= 1} onClick={() => goToPage(page - 1)}>上一页</button>
    <span>第 {page} / {pageCount} 页</span>
    <button className="secondary" type="button" disabled={page >= pageCount} onClick={() => goToPage(page + 1)}>下一页</button>
  </nav>;
}
