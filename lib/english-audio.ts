import type { ListeningSession } from "./english-listening";
/** Resolve only fields belonging to the already-authorized session. No browser-supplied text. */
export function listeningAudioText(session: ListeningSession, target: string, field: unknown = "phrase") {
  if (field !== "phrase" && field !== "example") throw new Error("朗读类型无效");
  if (target === "summary" && field === "phrase") return session.snapshot?.summary ?? "";
  if (/^q:[0-2]$/.test(target) && field === "phrase") return session.snapshot?.questions[Number(target.slice(2))]?.evidence ?? "";
  if (/^[wr]:[0-9]+$/.test(target)) {
    const term = (target[0] === "w" ? session.snapshot?.expressions : session.review_words)?.[Number(target.slice(2))];
    return term?.[field] ?? "";
  }
  return "";
}
