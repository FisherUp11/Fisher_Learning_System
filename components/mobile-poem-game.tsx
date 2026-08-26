"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { PoemGameAttemptInput, PoemGamePoem, PoemGameSummary } from "@/lib/poem-game";
import { speakPoemText, stopPoemSpeech, warmPoemSpeech } from "@/lib/poem-speech";

export function MobilePoemGame({ poem, distractorLines, onStart, onFinish }: { poem: PoemGamePoem; distractorLines: string[]; onStart: () => void; onFinish: (summary: PoemGameSummary) => void }) {
  const [phase, setPhase] = useState<"intro" | "questions" | "recital">("intro");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [message, setMessage] = useState("先听一遍、看一遍，再开始小坦克挑战。");
  const [showAnswer, setShowAnswer] = useState(false);
  const attempts = useRef<PoemGameAttemptInput[]>([]);
  const firstTry = useRef(true);
  const questionStartedAt = useRef(0);
  const startedAt = useRef(0);
  const maxQuestions = Math.min(poem.lines.length, 6);
  const fullPoem = `${poem.title}。${poem.lines.join("。")}`;

  const question = useMemo(() => {
    const answer = poem.lines[questionIndex] ?? poem.lines[0];
    return {
      answer,
      prompt: questionIndex === 0 ? `《${poem.title}》的第一句是？` : `${poem.lines[questionIndex - 1]}，下一句是？`,
    };
  }, [poem, questionIndex]);

  useEffect(() => {
    warmPoemSpeech(poem.lines);
    return stopPoemSpeech;
  }, [poem.lines]);

  const options = useMemo(() => {
    const wrong = distractorLines.filter((line) => line !== question.answer).slice(questionIndex * 2, questionIndex * 2 + 2);
    const fallback = poem.lines.filter((line) => line !== question.answer && line !== poem.lines[questionIndex - 1]);
    const rows = [question.answer, ...wrong, ...fallback].filter((line, index, all) => all.indexOf(line) === index).slice(0, 3);
    const shift = rows.length ? questionIndex % rows.length : 0;
    return [...rows.slice(shift), ...rows.slice(0, shift)];
  }, [distractorLines, poem.lines, question.answer, questionIndex]);

  function startQuestions(event: MouseEvent<HTMLButtonElement>) {
    onStart();
    startedAt.current = event.timeStamp;
    questionStartedAt.current = event.timeStamp;
    firstTry.current = true;
    setQuestionIndex(0);
    setPhase("questions");
    setMessage("看提示，点中装着正确诗句的小坦克。");
  }

  async function choose(selected: string, eventTime: number) {
    const correct = selected === question.answer;
    attempts.current.push({
      eventIndex: attempts.current.length,
      stage: "mobile",
      lineIndex: questionIndex,
      promptText: question.prompt,
      expectedText: question.answer,
      selectedText: selected,
      isCorrect: correct,
      isFirstTry: correct && firstTry.current,
      responseMs: Math.max(0, Math.round(eventTime - questionStartedAt.current)),
    });
    if (!correct) {
      firstTry.current = false;
      setMessage("差一点，正确诗句还在战场上，再找一找。");
      return;
    }
    setMessage(`命中！${question.answer}`);
    await speakPoemText(question.answer);
    if (questionIndex + 1 >= maxQuestions) {
      setShowAnswer(false);
      setPhase("recital");
      setMessage("小坦克任务完成。现在藏起答案，请孩子完整背一遍。");
    } else {
      firstTry.current = true;
      questionStartedAt.current = eventTime;
      setQuestionIndex((index) => index + 1);
    }
  }

  function finish(event: MouseEvent<HTMLButtonElement>) {
    const correctCount = attempts.current.filter((attempt) => attempt.isCorrect).length;
    const wrongCount = attempts.current.length - correctCount;
    onFinish({
      mode: "mobile",
      durationSeconds: Math.max(1, Math.round((event.timeStamp - startedAt.current) / 1000)),
      completedStage: "mobile",
      isCompleted: true,
      correctCount,
      wrongCount,
      firstTryCorrectCount: attempts.current.filter((attempt) => attempt.isCorrect && attempt.isFirstTry).length,
      bossHits: 0,
      attempts: attempts.current,
    });
  }

  return <section className="mobile-poem-game" aria-label="手机诗词小坦克">
    <div className="mobile-poem-game-head"><span>手机轻量模式</span><strong>{poem.title}</strong><small>{poem.author}{poem.dynasty ? ` · ${poem.dynasty}` : ""}</small></div>
    {phase === "intro" && <div className="mobile-poem-scroll">
      <div className="mobile-poem-lines">{poem.lines.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}</div>
      <p className="mobile-game-message">{message}</p>
      <button className="secondary" type="button" onClick={() => void speakPoemText(fullPoem)}>🔊 慢慢听完整首</button>
      <button className="primary" type="button" onClick={startQuestions}>驾驶小坦克出发</button>
    </div>}
    {phase === "questions" && <div className="mobile-tank-question">
      <div className="mobile-game-progress"><span style={{ width: `${(questionIndex / maxQuestions) * 100}%` }} /></div>
      <p className="mobile-question-count">第 {questionIndex + 1} / {maxQuestions} 题</p>
      <h2>{question.prompt}</h2>
      <div className="mobile-tank-targets">{options.map((option) => <button type="button" key={option} onClick={(event) => void choose(option, event.timeStamp)}><span aria-hidden="true">▰</span><strong>{option}</strong><small>点我开炮</small></button>)}</div>
      <p className="mobile-game-message" aria-live="polite">{message}</p>
    </div>}
    {phase === "recital" && <div className="mobile-recital-finish">
      <span className="mobile-finish-seal">背</span>
      <h2>请孩子完整背一遍</h2>
      <p>{showAnswer ? "可以看着答案慢慢再背一次。" : "正文已经藏好，家长先认真听。"}</p>
      {showAnswer && <div className="mobile-poem-lines answer">{poem.lines.map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}</div>}
      <div className="mobile-recital-actions"><button className="secondary" type="button" onClick={() => setShowAnswer((shown) => !shown)}>{showAnswer ? "藏起答案" : "需要时看答案"}</button><button className="secondary" type="button" onClick={() => void speakPoemText(fullPoem)}>🔊 听完整首</button></div>
      <button className="primary" type="button" onClick={finish}>孩子背完了 · 请家长评分</button>
    </div>}
  </section>;
}
