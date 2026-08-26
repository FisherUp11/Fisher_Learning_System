import Link from "next/link";
import { PoemGameExperience } from "@/components/poem-game-experience";
import { loadPoemGameHistory } from "@/lib/poem-game-data";
import { splitPoemLines, type PoemGamePoem } from "@/lib/poem-game";
import { loadPoemProgress } from "@/lib/poems";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ learner?: string; poem?: string }>;

export default async function PoemGamePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: learners, error: learnersError } = await supabase.from("learner_profiles").select("id,display_name").order("created_at");
  if (learnersError) return <section className="panel"><h1>诗词游戏暂时打不开</h1><p className="error">{learnersError.message}</p></section>;
  const learner = learners?.find((item) => item.id === params.learner) ?? learners?.[0];
  if (!learner) return <section className="empty panel"><span className="empty-mark">诗</span><h1>先创建孩子档案</h1><p className="lede">创建档案并分配诗词册后，才能生成专属诗境。</p><Link className="primary" href="/parent">去家长页</Link></section>;

  let loaded: Awaited<ReturnType<typeof loadPoemProgress>>;
  try {
    loaded = await loadPoemProgress(supabase, learner.id);
  } catch (error) {
    return <section className="panel"><h1>诗词游戏还差一步</h1><p className="lede">请先完成诗词模块数据库配置并给孩子分配诗词册。</p><p className="error">{error instanceof Error ? error.message : "无法读取诗词"}</p></section>;
  }
  if (!loaded.poems.length) return <section className="empty panel"><span className="empty-mark">卷</span><h1>{learner.display_name} 还没有可玩的诗</h1><p className="lede">先由家长或管理员导入并分配诗词册。</p><Link className="primary" href="/parent">去导入诗词</Link></section>;

  const selected = loaded.poems.find((poem) => poem.id === params.poem) ?? [...loaded.poems].sort((left, right) => left.attemptCount - right.attemptCount || (left.lastScore ?? 0) - (right.lastScore ?? 0) || left.sequence - right.sequence)[0];
  const poem: PoemGamePoem = {
    id: selected.id,
    title: selected.title,
    author: selected.author,
    dynasty: selected.dynasty,
    content: selected.content,
    lines: splitPoemLines(selected.content),
    sourceTitles: selected.sourceTitles,
    attemptCount: selected.attemptCount,
    lastScore: selected.lastScore,
  };
  const distractorLines = loaded.poems.filter((item) => item.id !== selected.id).flatMap((item) => splitPoemLines(item.content)).filter((line, index, rows) => rows.indexOf(line) === index).slice(0, 80);
  const gameHistory = await loadPoemGameHistory(supabase, learner.id, selected.id);

  return <div className="poem-game-page">
    <header className="hero poem-game-hero"><p className="eyebrow">Poem guardian</p><h1>诗境守卫战</h1><p className="lede">孩子驾驶小坦克击散“遗忘迷雾”，每次命中都会听见正确诗句；游戏后仍由家长判断是否真的会背。</p></header>

    <form className="panel poem-game-picker" method="get">
      <div><p className="eyebrow">生成今日关卡</p><h2>选择孩子和诗词</h2><p>可以主动选择任意已分配诗词；不选择时，会优先打开练习较少、评分较低的诗。</p></div>
      <label>哪位孩子？<select name="learner" defaultValue={learner.id}>{(learners ?? []).map((item) => <option value={item.id} key={item.id}>{item.display_name}</option>)}</select></label>
      <label>选择哪首诗？<select name="poem" defaultValue={selected.id}>{loaded.poems.map((item) => <option value={item.id} key={item.id}>{item.title} · {item.author}{item.lastScore ? ` · 最近 ${item.lastScore} 分` : item.attemptCount ? " · 待评分" : " · 未练"}</option>)}</select></label>
      <button className="primary" type="submit">生成这首诗的游戏</button>
      <Link className="text-button" href={`/poems/${selected.id}?learner=${learner.id}`}>先看诗词正文与原背诵记录 →</Link>
    </form>

    {gameHistory.error && <p className="error">读取游戏历史失败：{gameHistory.error}</p>}
    <PoemGameExperience key={`${learner.id}-${poem.id}`} learnerId={learner.id} learnerName={learner.display_name} poem={poem} distractorLines={distractorLines} history={gameHistory.rows} saveReady={!gameHistory.setupRequired} />
  </div>;
}
