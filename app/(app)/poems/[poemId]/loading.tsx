export default function PoemDetailLoading() {
  return <div className="poem-detail-page" role="status" aria-live="polite" aria-busy="true">
    <section className="poem-paper poem-detail-loading"><span className="loading-leaf" aria-hidden="true">诗</span><h1>正在展开诗卷…</h1><p className="poem-detail-byline">先准备正文，背诵情况随后显示。</p><div className="poem-skeleton-lines" aria-hidden="true"><span /><span /><span /><span /></div></section>
  </div>;
}
