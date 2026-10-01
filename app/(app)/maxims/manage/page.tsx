import Link from "next/link";
import { FeedbackForm } from "@/components/feedback-form";
import { importFamilyMaxims, saveFamilyMaxim } from "@/lib/family-maxims-actions";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import styles from "@/components/family-maxims.module.css";

export const dynamic="force-dynamic";
export default async function FamilyMaximManagePage() {
  const supabase=await createClient();
  const {data:{user}}=await supabase.auth.getUser();
  const access=user?await loadAccessContext(supabase,user.id):null;
  if (!access?.familyId) return <section className="panel"><h1>请先加入一个家庭</h1></section>;
  return <div className={styles.wrap}><header className="hero"><p className="eyebrow">Parent studio</p><h1>把值得记住的话留下来</h1><p className="lede">原文忠实保存；解释和父母的感悟分开写，之后都可以修正。</p></header>
    <div className={styles.twoColumn}><section className="panel"><div className={styles.sectionHead}><div><p className="eyebrow">One at a time</p><h2>逐句录入</h2></div></div><FeedbackForm action={saveFamilyMaxim} className={styles.form} successMessage="已加入家中册"><label>中文原句<textarea name="text_zh" required maxLength={1200} rows={3} placeholder="把想留给孩子的话写在这里" /></label><label>英文原句<textarea name="text_en" required maxLength={2000} rows={3} placeholder="English quotation or translation" /></label><div className={styles.formPair}><label>出处书名<input name="source_title" maxLength={160} placeholder="例如：圣经、论语" /></label><label>具体出处<input name="source_detail" maxLength={160} placeholder="章节、篇名或页码" /></label></div><label>译本／版本<input name="translation_version" maxLength={120} placeholder="不同译本请注明" /></label><label>意思介绍<textarea name="explanation_zh" maxLength={2000} rows={3} /></label><label>给孩子的解释<textarea name="child_explanation_zh" maxLength={800} rows={2} placeholder="用孩子容易理解的话说一说" /></label><label>标签<input name="tags" maxLength={200} placeholder="例如：耐心、爱、感恩" /></label><button className="primary">收进家中册</button></FeedbackForm><p className={styles.muted}>父母自己的心得请在保存后打开这一条，单独添加；默认不会展示给孩子。</p></section>
    <section className="panel"><div className={styles.sectionHead}><div><p className="eyebrow">A whole page</p><h2>批量导入 CSV</h2></div><a className={styles.quietLink} href="/api/templates/family-maxims" download>下载 CSV 模板 ↓</a></div><p>第一次可以导入很多条，之后再导入新文件会追加。相同的原句、译本和出处会跳过，不覆盖已有感悟。</p><FeedbackForm action={importFamilyMaxims} className={styles.form} clearFileOnSuccess pendingLabel="正在核对并导入…" confirm={{title:"确认把这份 CSV 收进家中册？",description:"会逐行检查；同样的条目不会重复加入。家长感悟不会随分享公开。",confirmLabel:"确认导入"}}><label>选择 CSV 文件<input name="csv_file" type="file" accept=".csv,text/csv" required /></label><button className="primary">校验并导入</button></FeedbackForm><div className={styles.paperNote}><strong>导入提醒</strong><p>模板有中文、英文、出处、解释和父母感悟等列。出现问题会显示具体行号，并且本次不导入任何内容。</p></div><Link className="secondary" href="/maxims">回家中册查看</Link></section></div>
  </div>;
}
