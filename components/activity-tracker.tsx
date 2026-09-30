"use client";

import { useEffect } from "react";

const HEARTBEAT_MS = 30_000;
const IDLE_MS = 90_000;

function currentLearnerId() {
  const marked = document.querySelector<HTMLElement>("[data-current-learner]")?.dataset.currentLearner;
  return marked || new URLSearchParams(window.location.search).get("learner") || null;
}

function mediaPlaying() {
  return Array.from(document.querySelectorAll<HTMLMediaElement>("audio,video")).some((media) => !media.paused && !media.ended);
}

/** Counts foreground, recently-interacted time only; sends aggregates, never page content. */
export function ActivityTracker() {
  useEffect(() => {
    let lastInteraction = Date.now();
    let lastBeat = Date.now();
    let pendingVisit = false;
    try {
      const today = new Date().toDateString();
      if (sessionStorage.getItem("activity-visit") !== today) {
        sessionStorage.setItem("activity-visit", today);
        pendingVisit = true;
      }
    } catch {}

    function send(final: boolean) {
      const now = Date.now();
      // On pagehide/hidden the page was visible until this moment.
      const active = (final || document.visibilityState === "visible") && (now - lastInteraction < IDLE_MS || mediaPlaying());
      const seconds = active ? Math.min(90, Math.round((now - lastBeat) / 1000)) : 0;
      lastBeat = now;
      if (!seconds && !pendingVisit) return;
      const body = JSON.stringify({ learnerId: currentLearnerId(), seconds, newVisit: pendingVisit });
      pendingVisit = false;
      void fetch("/api/activity", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: final }).catch(() => undefined);
    }

    const touch = () => { lastInteraction = Date.now(); };
    const onHide = () => send(true);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") send(true);
      else { lastBeat = Date.now(); touch(); }
    };
    const events = ["pointerdown", "keydown", "touchstart", "scroll", "wheel"] as const;
    events.forEach((name) => window.addEventListener(name, touch, { passive: true }));
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    const timer = window.setInterval(() => send(false), HEARTBEAT_MS);
    const first = window.setTimeout(() => send(false), 5_000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(first);
      events.forEach((name) => window.removeEventListener(name, touch));
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);
  return null;
}
