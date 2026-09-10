import styles from "@/components/app-shell.module.css";

export default function AppLoading() {
  return <section className="panel page-loading" role="status" aria-live="polite" aria-label="正在切换页面" aria-busy="true">
    <span className="loading-leaf" aria-hidden="true">芽</span>
    <div className={styles.loadingDetails}><div><strong>正在打开…</strong><p>已收到操作，正在准备这一页。</p></div><div className={styles.loadingLines} aria-hidden="true"><span /><span /></div></div>
  </section>;
}
