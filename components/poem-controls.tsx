"use client";

import { useRouter } from "next/navigation";

type LearnerChoice = { id: string; display_name: string };
type CollectionChoice = { id: string; title: string };

type QueryState = {
  learnerId: string;
  query: string;
  filter: string;
  collectionId?: string;
  page?: number;
};

function poemsHref({ learnerId, query, filter, collectionId, page = 1 }: QueryState) {
  const params = new URLSearchParams({ learner: learnerId });
  if (query) params.set("q", query);
  if (filter !== "all") params.set("filter", filter);
  if (collectionId) params.set("collection", collectionId);
  if (page > 1) params.set("page", String(page));
  return `/poems?${params.toString()}`;
}

export function PoemControls({ learners, learnerId, collections, collectionId, query, filter }: {
  learners: LearnerChoice[];
  learnerId: string;
  collections: CollectionChoice[];
  collectionId?: string;
  query: string;
  filter: string;
}) {
  const router = useRouter();
  function switchLearner(formData: FormData) {
    router.push(poemsHref({ learnerId: String(formData.get("learner") ?? learnerId), query: "", filter: "all" }));
  }
  function applyFilters(formData: FormData) {
    router.push(poemsHref({
      learnerId,
      query: String(formData.get("q") ?? "").trim().slice(0, 60),
      filter: String(formData.get("filter") ?? "all"),
      collectionId: String(formData.get("collection") ?? "") || undefined,
    }));
  }

  return <>
    {learners.length > 1 && <form className="learner-switch" onSubmit={(event) => { event.preventDefault(); switchLearner(new FormData(event.currentTarget)); }}>
      <label>查看哪位孩子？<select name="learner" defaultValue={learnerId}>{learners.map((learner) => <option key={learner.id} value={learner.id}>{learner.display_name}</option>)}</select></label>
      <button className="secondary" type="submit">切换</button>
    </form>}
    <form className="poem-filters" onSubmit={(event) => { event.preventDefault(); applyFilters(new FormData(event.currentTarget)); }}>
      <label className="library-query">搜索题目、作者或正文<input name="q" defaultValue={query} placeholder="例如：静夜思、李白、明月" /></label>
      <label>来源诗词册<select name="collection" defaultValue={collectionId ?? ""}><option value="">全部已导入诗词册（{collections.length} 份）</option>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.title}</option>)}</select></label>
      <label>背诵情况<select name="filter" defaultValue={filter}><option value="all">全部</option><option value="never">还没打卡</option><option value="few">背诵少于 2 次</option><option value="unscored">已打卡，暂未评分</option><option value="low">最近评分 6 分及以下</option><option value="stale">超过 14 天未背</option></select></label>
      <button className="secondary" type="submit">筛选</button>
      {(query || filter !== "all" || collectionId) && <button className="text-button" type="button" onClick={() => router.push(poemsHref({ learnerId, query: "", filter: "all" }))}>清除条件</button>}
    </form>
  </>;
}

export function PoemPagination({ learnerId, query, filter, collectionId, page, pageCount }: QueryState & { page: number; pageCount: number }) {
  const router = useRouter();
  if (pageCount <= 1) return null;
  return <nav className="library-pagination" aria-label="诗词分页">
    <button className="secondary" type="button" disabled={page <= 1} onClick={() => router.push(poemsHref({ learnerId, query, filter, collectionId, page: page - 1 }))}>上一页</button>
    <span>第 {page} / {pageCount} 页</span>
    <button className="secondary" type="button" disabled={page >= pageCount} onClick={() => router.push(poemsHref({ learnerId, query, filter, collectionId, page: page + 1 }))}>下一页</button>
  </nav>;
}
