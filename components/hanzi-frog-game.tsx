"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { FROG_LEVELS, makeFrogQuestions, type FrogDifficulty, type FrogQuestion, type FrogWord } from "@/lib/hanzi-frog";
import { saveHanziFrogGame } from "@/lib/hanzi-frog-actions";
import styles from "@/components/hanzi-frog-game.module.css";

type Song = { id: string; title: string; audioUrl: string };
type History = { id: string; difficulty: string; question_count: number; first_touch_correct: number; wrong_count: number; playedDate: string };
type Tap = { selectedId: string; elapsedMs: number; replayCount: number };
type Round = { targetId: string; options: string[]; taps: Tap[]; replayCount: number };
type Saved = { session_id: string; question_count: number; first_touch_correct: number; wrong_count: number; replay_count: number };
type Phase = "ready" | "playing" | "saving" | "done";

const scenes = ["晨光荷塘", "芦苇小溪", "星光池塘"];
const cheer = ["找对啦，小青蛙跳过一片叶子！", "好耳力！再跳一跳。", "听清楚了，前面还有新风景。"];

function Frog({ hopping }: { hopping: number }) {
  return <svg key={hopping} className={styles.frog} viewBox="0 0 160 130" aria-hidden="true">
    <ellipse cx="80" cy="119" rx="56" ry="9" fill="#28695a" opacity=".18" />
    <path d="M25 85C25 55 48 39 80 39s55 16 55 46c0 21-24 34-55 34S25 106 25 85Z" fill="#79b966" stroke="#2d6654" strokeWidth="4" />
    <circle cx="48" cy="45" r="19" fill="#86c570" stroke="#2d6654" strokeWidth="4" />
    <circle cx="112" cy="45" r="19" fill="#86c570" stroke="#2d6654" strokeWidth="4" />
    <circle cx="50" cy="43" r="7" fill="#243e36" /><circle cx="110" cy="43" r="7" fill="#243e36" />
    <circle cx="52" cy="41" r="2" fill="white" /><circle cx="112" cy="41" r="2" fill="white" />
    <circle cx="49" cy="83" r="5" fill="#ea9e91" opacity=".8" /><circle cx="111" cy="83" r="5" fill="#ea9e91" opacity=".8" />
    <path d="M64 86q16 12 32 0" fill="none" stroke="#285944" strokeWidth="4" strokeLinecap="round" />
    <path d="M38 104l-17 10m101-10 17 10" stroke="#2d6654" strokeWidth="7" strokeLinecap="round" />
  </svg>;
}

export function HanziFrogGame({ learnerId, learnerName, words, songs, history, weakWords }: {
  learnerId: string; learnerName: string; words: FrogWord[]; songs: Song[]; history: History[]; weakWords: { hanzi: string; wrongCount: number }[];
}) {
  const [difficulty, setDifficulty] = useState<FrogDifficulty>("normal");
  const [songId, setSongId] = useState("");
  const selectedSong = songs.find((song) => song.id === songId);
  const [musicOn, setMusicOn] = useState(true);
  const [phase, setPhase] = useState<Phase>("ready");
  const [questions, setQuestions] = useState<FrogQuestion[]>([]);
  const [queue, setQueue] = useState<number[]>([]);
  const [pads, setPads] = useState<FrogWord[]>([]);
  const [feedback, setFeedback] = useState<{ selected: string; correct: boolean; message: string } | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [soundMessage, setSoundMessage] = useState("");
  const [musicMessage, setMusicMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [setupError, setSetupError] = useState("");
  const [saved, setSaved] = useState<Saved | null>(null);
  const [firstCorrect, setFirstCorrect] = useState(0);
  const [hopCount, setHopCount] = useState(0);
  const [roundKey, setRoundKey] = useState(0);
  const voiceRef = useRef<HTMLAudioElement | null>(null);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const roundsRef = useRef<Round[]>([]);
  const retriesRef = useRef<number[]>([]);
  const requestIdRef = useRef("");
  const startedAtRef = useRef(0);
  const durationRef = useRef(0);
  const roundStartedAtRef = useRef(0);
  const nextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechTokenRef = useRef(0);
  const firstPromptStartedRef = useRef(false);

  const currentIndex = queue[0];
  const current = questions[currentIndex];
  const level = FROG_LEVELS[difficulty];
  const completed = phase === "playing" || phase === "saving" || phase === "done" ? questions.length - new Set(queue).size : 0;
  const chapter = Math.min(2, Math.floor(completed / Math.max(1, Math.ceil(questions.length / 3))));
  const accuracy = saved ? Math.round(saved.first_touch_correct / saved.question_count * 100)
    : questions.length ? Math.round(firstCorrect / questions.length * 100) : 0;

  useEffect(() => () => {
    if (nextTimerRef.current) clearTimeout(nextTimerRef.current);
    speechTokenRef.current += 1;
    voiceRef.current?.pause();
    musicRef.current?.pause();
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  }, []);

  function stopVoice() {
    speechTokenRef.current += 1;
    voiceRef.current?.pause();
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    setSpeaking(false);
    if (musicRef.current) musicRef.current.volume = musicOn ? 0.16 : 0;
  }

  function browserVoice(text: string, token: number) {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      setSoundMessage("朗读暂时不可用，请家长读出这个字后继续玩。");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.75;
    utterance.onend = () => { if (speechTokenRef.current === token) { setSpeaking(false); if (musicRef.current) musicRef.current.volume = 0.16; } };
    utterance.onerror = () => { if (speechTokenRef.current === token) { setSpeaking(false); setSoundMessage("请点一下喇叭重听，或者由家长读这个字。"); } };
    window.speechSynthesis.speak(utterance);
  }

  function sayWord(word: FrogWord, manual: boolean) {
    if (manual) {
      const record = roundsRef.current.find((round) => round.targetId === word.character_id);
      if (record) record.replayCount += 1;
    }
    stopVoice();
    const token = speechTokenRef.current;
    setSoundMessage("");
    setSpeaking(true);
    if (musicRef.current) musicRef.current.volume = 0.035;
    const audio = voiceRef.current;
    if (!audio) { browserVoice(word.hanzi, token); return; }
    audio.src = `/api/speech?learner=${encodeURIComponent(learnerId)}&module=hanzi&slow=1&text=${encodeURIComponent(word.hanzi)}`;
    audio.onended = () => {
      if (speechTokenRef.current !== token) return;
      setSpeaking(false);
      if (musicRef.current) musicRef.current.volume = 0.16;
    };
    audio.onerror = () => {
      if (speechTokenRef.current !== token) return;
      setSoundMessage("已换用设备朗读；如果没听到，请点喇叭再试。");
      browserVoice(word.hanzi, token);
    };
    void audio.play().catch(() => {
      if (speechTokenRef.current !== token) return;
      setSoundMessage("请点喇叭重听，iPhone 可能暂停自动播放。");
      browserVoice(word.hanzi, token);
    });
  }

  // An automatic prompt is attempted on each new landing; the prominent replay
  // button is the explicit-gesture fallback required by mobile Safari.
  useEffect(() => {
    if (phase !== "playing" || !current) return;
    roundStartedAtRef.current = performance.now();
    if (firstPromptStartedRef.current) { firstPromptStartedRef.current = false; return; }
    // The first prompt is started by the same user gesture as the Begin button.
    const timeout = window.setTimeout(() => sayWord(current.target, false), 60);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentIndex, roundKey]);

  function begin(event: MouseEvent<HTMLButtonElement>) {
    const prepared = makeFrogQuestions(words, difficulty);
    if (prepared.length < 4) {
      setSetupError("目前已学字的读音还不够多；先试试较轻松的难度，或回正式字卡多学几个字。");
      return;
    }
    setSetupError("");
    requestIdRef.current = crypto.randomUUID();
    roundsRef.current = prepared.map((question) => ({
      targetId: question.target.character_id,
      options: question.options.map((option) => option.character_id),
      taps: [], replayCount: 0,
    }));
    retriesRef.current = prepared.map(() => 0);
    startedAtRef.current = event.timeStamp;
    durationRef.current = 0;
    setQuestions(prepared);
    setPads([...prepared[0].options]);
    setQueue(prepared.map((_, index) => index));
    setRoundKey(0);
    setFeedback(null);
    setSaved(null);
    setFirstCorrect(0);
    setSaveError("");
    setHopCount(0);
    setPhase("playing");
    const music = musicRef.current;
    if (music && selectedSong && musicOn) {
      music.volume = 0.16;
      music.src = selectedSong.audioUrl;
      void music.play().then(() => setMusicMessage("")).catch(() => setMusicMessage("背景音乐暂未播放；点“播放配乐”可重试，不影响游戏。"));
    }
    firstPromptStartedRef.current = true;
    // Start the first sound inside the click gesture for mobile Safari.
    sayWord(prepared[0].target, false);
  }

  async function finish() {
    setPhase("saving");
    setSaveError("");
    stopVoice();
    musicRef.current?.pause();
    try {
      const result = await saveHanziFrogGame({
        requestId: requestIdRef.current,
        learnerId, difficulty,
        durationMs: durationRef.current,
        rounds: roundsRef.current,
      });
      setSaved(result);
      setPhase("done");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "记录暂时没保存成功，请重试");
      setPhase("done");
    }
  }

  function choose(word: FrogWord, event: MouseEvent<HTMLButtonElement>) {
    if (phase !== "playing" || !current || feedback) return;
    const correct = word.character_id === current.target.character_id;
    if (correct) stopVoice();
    else sayWord(current.target, false);
    roundsRef.current[currentIndex].taps.push({
      selectedId: word.character_id,
      elapsedMs: Math.min(600000, Math.max(0, Math.round(event.timeStamp - roundStartedAtRef.current))),
      replayCount: roundsRef.current[currentIndex].replayCount,
    });
    const repeat = !correct && retriesRef.current[currentIndex] < 2;
    if (correct && roundsRef.current[currentIndex].taps.length === 1) setFirstCorrect((value) => value + 1);
    if (repeat) retriesRef.current[currentIndex] += 1;
    durationRef.current = Math.max(0, Math.round(event.timeStamp - startedAtRef.current));
    setFeedback({ selected: word.character_id, correct,
      message: correct ? cheer[hopCount % cheer.length]
        : repeat ? `这次是“${current.target.hanzi}”。听一听，过两跳再找它。`
          : `这次是“${current.target.hanzi}”。我们先记在小本子里，下次再练。` });
    nextTimerRef.current = setTimeout(() => {
      const remaining = queue.slice(1);
      if (repeat) remaining.splice(Math.min(2, remaining.length), 0, currentIndex);
      if (!remaining.length) {
        setQueue([]);
        void finish();
        return;
      }
      const next = questions[remaining[0]];
      setPads([...next.options].sort(() => Math.random() - 0.5));
      setQueue(remaining);
      setRoundKey((value) => value + 1);
      setHopCount((value) => value + 1);
      setFeedback(null);
    }, correct ? 720 : 1600);
  }

  function toggleMusic() {
    const next = !musicOn;
    setMusicOn(next);
    const audio = musicRef.current;
    if (!audio) return;
    if (!next) audio.pause();
    else if (selectedSong) {
      audio.volume = 0.16;
      if (!audio.src) audio.src = selectedSong.audioUrl;
      void audio.play().then(() => setMusicMessage("")).catch(() => setMusicMessage("配乐暂时不能播放，认字仍可继续。"));
    }
  }

  return <div className={styles.page}>
    <audio ref={voiceRef} preload="none" aria-hidden="true" />
    <audio ref={musicRef} preload="none" loop onError={() => setMusicMessage("这首配乐没能播放：请检查音频直链或来源网站是否允许外站播放；认字仍可继续。")} aria-hidden="true" />
    <header className={styles.header}>
      <div><p className={styles.kicker}>字芽 · 听音识字</p><h1>青蛙跳字岛</h1><p>听一个字，点一片字叶，陪小青蛙跳过今天的池塘。</p></div>
      <Link className={styles.back} href={`/learn?learner=${learnerId}`}>← 回到学字</Link>
    </header>

    {phase === "ready" && <div className={styles.setup}>
      <div className={styles.introCard}><div className={styles.introFrog}><Frog hopping={0} /></div>
        <div><span className={styles.pill}>给 {learnerName} 的小冒险</span><h2>听准了，就跳！</h2><p>从已学字里挑今天到期的字。每跳听一声，选对后青蛙前进；选错的字会隔几跳再来。没有倒计时，也不扣生命。</p></div>
      </div>
      <section className={styles.setupCard}><h2>选一种跳法</h2><div className={styles.levels}>
        {(["easy", "normal", "challenge"] as const).map((id) => <button type="button" key={id} className={`${styles.level} ${difficulty === id ? styles.levelActive : ""}`} onClick={() => setDifficulty(id)} aria-pressed={difficulty === id}>
          <strong>{FROG_LEVELS[id].label}</strong><span>{FROG_LEVELS[id].options} 个字叶 · 约 {FROG_LEVELS[id].targets} 跳</span>
        </button>)}
      </div><p className={styles.smallNote}>难度只改变候选字和落叶节奏，不改变正式复习安排。</p>
      <label className={styles.musicSelect}>池塘里的轻音乐 <select value={songId} onChange={(event) => { setSongId(event.target.value); setMusicMessage(""); }}><option value="">不播放背景音乐</option>{songs.map((song) => <option key={song.id} value={song.id}>{song.title}</option>)}</select></label>
      <Link className={styles.musicManage} href={`/learn/frog/music?learner=${learnerId}`}>家长维护游戏配乐 →</Link>
      <button type="button" className={styles.start} disabled={words.length < FROG_LEVELS[difficulty].options} onClick={begin}>出发，跳字岛 →</button>
      {words.length < FROG_LEVELS[difficulty].options && <p className={styles.smallNote}>先用正式字卡认识至少 {FROG_LEVELS[difficulty].options} 个不同读音的字，就能开始玩。</p>}
      {setupError && <p className={styles.saveError} role="alert">{setupError}</p>}
      </section>
      {history.length > 0 && <section className={styles.history}><h2>最近的小冒险</h2>{history.map((item) => <div key={item.id}><span>{item.playedDate}</span><strong>{Math.round(item.first_touch_correct / item.question_count * 100)}% 首选正确</strong><small>{item.question_count} 字 · 误点 {item.wrong_count} 次</small></div>)}
        {weakWords.length > 0 && <><h3>最近容易听错</h3><p className={styles.weakWords}>{weakWords.map((item) => <span key={item.hanzi}>{item.hanzi}<small>{item.wrongCount} 次</small></span>)}</p></>}
      </section>}
    </div>}

    {phase === "playing" && current && <div className={`${styles.scene} ${styles[`scene${chapter}`]}`}>
      <div className={styles.sky}><span className={styles.cloudOne} /><span className={styles.cloudTwo} /><span className={styles.sunMoon}>{chapter === 2 ? "✦" : "☀"}</span></div>
      <div className={styles.sceneTop}><span className={styles.sceneName}>{scenes[chapter]}</span><span>已跳 {completed} / {questions.length}</span></div>
      <div className={styles.progress}><span style={{ width: `${completed / questions.length * 100}%` }} /></div>
      <div className={styles.prompt}><div className={styles.promptIcon}>♫</div><div><strong>听一听，哪个字在叫你？</strong><span>{speaking ? "正在慢慢读…" : "没听清可以再听一次"}</span></div><button type="button" onClick={() => sayWord(current.target, true)}>🔊 再听</button></div>
      <div className={styles.pads} key={roundKey} style={{ "--fall-ms": `${level.fallMs}ms` } as React.CSSProperties}>
        {pads.map((word, index) => <button type="button" key={word.character_id} className={`${styles.pad} ${feedback?.selected === word.character_id ? (feedback.correct ? styles.right : styles.wrong) : ""} ${feedback && word.character_id === current.target.character_id ? styles.answer : ""}`}
          style={{ animationDelay: `${index * 90}ms` }} disabled={Boolean(feedback)} onClick={(event) => choose(word, event)} aria-label={`选择汉字 ${word.hanzi}`}><span>{word.hanzi}</span></button>)}
      </div>
      <div className={styles.pond}><span className={styles.reeds}>✦ ︵ ︵</span><Frog hopping={hopCount} /><span className={styles.reeds}>︵ ︵ ✦</span></div>
      <p className={`${styles.feedback} ${feedback?.correct ? styles.positive : ""}`} aria-live="polite">{feedback?.message ?? "小青蛙等你点对的字叶。"}</p>
      <div className={styles.controls}><button type="button" onClick={toggleMusic} disabled={!songId}>{musicOn && songId ? "♫ 关闭配乐" : "♫ 播放配乐"}</button><span>没有限时 · 可以慢慢听</span></div>
      {(soundMessage || musicMessage) && <p className={styles.audioNotice} role="status">{soundMessage || musicMessage}</p>}
    </div>}

    {(phase === "saving" || phase === "done") && <section className={styles.result}>
      <div className={styles.resultFrog}><Frog hopping={hopCount} /></div>
      <p className={styles.kicker}>今日池塘探险</p><h2>{phase === "saving" ? "正在把足迹记下来…" : "小青蛙到岸啦！"}</h2>
      <strong className={styles.score}>{accuracy}<small>%</small></strong><p>首选正确率 · {saved?.first_touch_correct ?? firstCorrect} / {questions.length} 个字</p>
      <p className={styles.smallNote}>这只是听音选字成绩，不代表已在正式字卡上独立认出；到期字仍按原记忆曲线复习。</p>
      {saveError && <div className={styles.saveError}><p>这局暂时没保存：{saveError}</p><button type="button" onClick={() => void finish()}>重试保存</button></div>}
      {saved && <p className={styles.saved}>✓ 已保存到 {learnerName} 的趣味练习记录 · 误点 {saved.wrong_count} 次 · 重听 {saved.replay_count} 次</p>}
      <div className={styles.resultActions}><Link href={`/learn?learner=${learnerId}`}>去正式字卡复习 →</Link><button type="button" onClick={() => { setPhase("ready"); setQuestions([]); setQueue([]); setFeedback(null); }}>再玩一局</button></div>
    </section>}
  </div>;
}
