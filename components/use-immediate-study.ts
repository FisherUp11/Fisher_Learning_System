"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { forgetStudyAnswer, readStudyAnswer, rememberStudyAnswer, type StudyAnswer, type StudyScope } from "@/lib/study-answer-sync";

type Status = "loading" | "ready" | "saving" | "save-error" | "sync-error";
const browserStore = {
  getItem: (key: string) => window.sessionStorage.getItem(key),
  setItem: (key: string, value: string) => window.sessionStorage.setItem(key, value),
  removeItem: (key: string) => window.sessionStorage.removeItem(key),
};
type Options<T, S> = {
  scope: StudyScope; learnerId: string;
  load: (learnerId: string) => Promise<T>;
  save: (answer: StudyAnswer) => Promise<S>;
  advance: (data: T, answer: StudyAnswer) => T;
  reconcile: (saved: S, previous: T | null) => T | null;
};

// One write in flight. Only presentation advances optimistically, never scores or stages.
export function useImmediateStudy<T, S>({ scope, learnerId, load, save, advance, reconcile }: Options<T, S>) {
  const [data, setData] = useState<T | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [lastCommit, setLastCommit] = useState<{ answer: StudyAnswer; saved: S } | null>(null);
  const pending = useRef<StudyAnswer | null>(null);
  const locked = useRef(true);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const dataRef = useRef<T | null>(null);

  const put = useCallback((next: T) => { dataRef.current = next; setData(next); }, []);
  const commit = useCallback(async (answer: StudyAnswer, version: number) => {
    if (inFlight.current) return;
    inFlight.current = true;
    let acknowledged = false;
    try {
      const saved = await save(answer);
      acknowledged = true;
      forgetStudyAnswer(browserStore, scope, answer);
      if (!mounted.current || generation.current !== version) return;
      pending.current = null;
      setLastCommit({ answer, saved });
      const next = reconcile(saved, dataRef.current);
      if (!next) throw new Error("回答已保存，但后面的卡片暂时没有同步。请重试加载；不会重复记分。");
      put(next);
      setError("");
      setStatus("ready");
      locked.current = false;
    } catch (cause) {
      if (!mounted.current || generation.current !== version) return;
      setError(acknowledged ? "回答已保存，但后面的卡片暂时没有同步。请重试加载；不会重复记分。"
        : `上一张的保存尚未确认，请重试保存。这次回答不会重复计数。${cause instanceof Error ? `（${cause.message}）` : ""}`);
      setStatus(acknowledged ? "sync-error" : "save-error");
      // Keep grading locked on failure; the next visible card is only a preview.
    } finally { inFlight.current = false; }
  }, [put, reconcile, save, scope]);

  const reload = useCallback(async () => {
    if (pending.current) return;
    const version = ++generation.current;
    locked.current = true;
    setStatus("loading");
    setError("");
    try {
      const next = await load(learnerId);
      if (!mounted.current || version !== generation.current) return;
      put(next); setStatus("ready"); locked.current = false;
    } catch (cause) {
      if (!mounted.current || version !== generation.current) return;
      setError(cause instanceof Error ? cause.message : "学习任务暂时无法加载");
      setStatus("sync-error");
    }
  }, [learnerId, load, put]);

  useEffect(() => {
    mounted.current = true;
    const version = ++generation.current;
    const recovery = readStudyAnswer(browserStore, scope, learnerId);
    queueMicrotask(() => {
      if (!mounted.current || generation.current !== version) return;
      if (recovery) {
        pending.current = recovery; locked.current = true; setStatus("saving");
        void commit(recovery, version);
      } else void reload();
    });
    const warn = (event: BeforeUnloadEvent) => {
      if (pending.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => { mounted.current = false; generation.current += 1; window.removeEventListener("beforeunload", warn); };
  }, [commit, learnerId, reload, scope]);

  const submit = useCallback((input: Omit<StudyAnswer, "requestId" | "learnerId">) => {
    if (locked.current || pending.current || !dataRef.current) return false;
    locked.current = true;
    const answer: StudyAnswer = { ...input, learnerId, requestId: crypto.randomUUID() };
    pending.current = answer;
    setError(""); setStatus("saving");
    // If browser storage is unavailable, save before switching rather than risk losing recovery.
    if (rememberStudyAnswer(browserStore, scope, answer)) put(advance(dataRef.current, answer));
    void commit(answer, ++generation.current);
    return true;
  }, [advance, commit, learnerId, put, scope]);

  const retry = useCallback(() => {
    if (inFlight.current || status === "saving" || status === "loading") return;
    if (!pending.current) { void reload(); return; }
    setStatus("saving"); setError("");
    void commit(pending.current, ++generation.current);
  }, [commit, reload, status]);

  const discard = useCallback(() => {
    if (status !== "save-error" || !pending.current || !window.confirm("这次回答的保存尚未确认。重新加载会以数据库实际记录为准；未保存的回答需要再认一次。继续吗？")) return;
    forgetStudyAnswer(browserStore, scope, pending.current);
    pending.current = null;
    void reload();
  }, [reload, scope, status]);

  return { data, status, error, lastCommit, submit, retry, discard, reload, blocked: status !== "ready" };
}
