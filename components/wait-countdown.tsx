"use client";

import { useEffect, useState } from "react";
import styles from "./wait-countdown.module.css";

const storageKey = (key: string) => `wait-estimate:${key}`;

function readEstimate(key: string, fallbackSeconds: number) {
  try {
    const saved = Number(window.localStorage.getItem(storageKey(key)));
    if (Number.isFinite(saved) && saved > 0) return Math.min(60, Math.max(2, Math.round(saved)));
  } catch {}
  return fallbackSeconds;
}

/** Call after a successful wait so the next countdown matches this device and network. */
export function rememberWaitDuration(key: string, milliseconds: number) {
  try {
    const seconds = milliseconds / 1000;
    const previous = Number(window.localStorage.getItem(storageKey(key)));
    const next = Number.isFinite(previous) && previous > 0 ? previous * 0.6 + seconds * 0.4 : seconds;
    window.localStorage.setItem(storageKey(key), String(Math.min(60, Math.max(1, next))));
  } catch {}
}

export function WaitCountdown({ waitKey, fallbackSeconds, label, compact = false }: {
  waitKey: string;
  fallbackSeconds: number;
  label: string;
  compact?: boolean;
}) {
  const [estimate] = useState(() => typeof window === "undefined" ? fallbackSeconds : readEstimate(waitKey, fallbackSeconds));
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = performance.now();
    const timer = window.setInterval(() => setElapsed((performance.now() - started) / 1000), 200);
    return () => window.clearInterval(timer);
  }, []);
  const remaining = Math.max(1, Math.ceil(estimate - elapsed));
  const overtime = elapsed >= estimate;
  const progress = Math.min(1, elapsed / estimate);
  const circumference = 2 * Math.PI * 20;
  return <span className={`${styles.wrap} ${compact ? styles.compact : ""}`} role="status" aria-live="polite">
    <span className={`${styles.ring} ${overtime ? styles.overtime : ""}`} aria-hidden="true">
      <svg viewBox="0 0 48 48">
        <circle className={styles.track} cx="24" cy="24" r="20" />
        <circle className={styles.bar} cx="24" cy="24" r="20" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)} />
      </svg>
      <strong>{overtime ? "…" : remaining}</strong>
    </span>
    <span className={styles.text}>{label}<small>{overtime ? "马上就好，请再等一下" : `预计还要约 ${remaining} 秒`}</small></span>
  </span>;
}
