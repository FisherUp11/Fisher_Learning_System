import Link from "next/link";
import { AdultVideoDesk, NewVideoProfile } from "@/components/adult-video-desk";
import { loadVideoPage } from "@/lib/adult-video-server";
import s from "@/components/adult-video.module.css";

export const metadata = { title: "视频跟读 · 字芽" };

export default async function AdultVideoPage({ searchParams }: {
  searchParams: Promise<{ profile?: string; video?: string; page?: string; words?: string; view?: string }>;
}) {
  const query = await searchParams;
  const loaded = await loadVideoPage(query).catch((error: unknown) => ({
    people: [], profile: null, data: null, error: error instanceof Error ? error.message : "暂时打不开视频跟读",
  }));
  const { people, profile, data, error } = loaded;
  return <div className={s.desk}>
    <nav className={s.directions} aria-label="父母英语方向"><Link href="/english">会议英语</Link><Link href="/english/academic">专业英语</Link><span aria-current="page">视频跟读</span></nav>
    <header className={s.masthead}>
      <div><p className={s.kicker}>LISTEN · REPEAT · REMEMBER</p><h1>视频跟读<span aria-hidden="true">.</span></h1><p className={s.intro}>每周一条视频，反复听、开口跟读，把有用的词句留下来。</p></div>
      {!!people.length && <nav className={s.profiles} aria-label="选择成人档案">{people.map(person => <Link key={person.id}
        href={`/english/video?profile=${person.id}`} aria-current={profile?.id === person.id ? "page" : undefined}>{person.name}</Link>)}</nav>}
    </header>
    {error ? <section className={s.paper} role="alert"><h2>暂时打不开练习</h2><p>{error}</p><Link href="/english/video">返回视频跟读 ↗</Link></section>
      : profile && data ? <AdultVideoDesk key={profile.id} profileId={profile.id} data={data} wordView={query.view === "words"} />
        : <NewVideoProfile />}
  </div>;
}
