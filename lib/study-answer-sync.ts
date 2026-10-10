export type StudyAnswer = {
  learnerId: string;
  itemId: string;
  result: "known" | "again" | "helped";
  assisted: boolean;
  requestId: string;
};
export type StudyScope = "hanzi" | "pinyin";
export type AnswerStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function key(scope: StudyScope, learnerId: string) { return `ziya:pending-answer:v1:${scope}:${learnerId}`; }

export function readStudyAnswer(store: AnswerStore, scope: StudyScope, learnerId: string): StudyAnswer | null {
  try {
    const value = JSON.parse(store.getItem(key(scope, learnerId)) ?? "null");
    if (!value || value.learnerId !== learnerId || typeof value.itemId !== "string" || !value.itemId
      || typeof value.requestId !== "string" || !value.requestId || typeof value.assisted !== "boolean"
      || !["known", "again", "helped"].includes(value.result)) return null;
    return { learnerId, itemId: value.itemId, requestId: value.requestId, result: value.result, assisted: value.assisted };
  } catch { return null; }
}

export function rememberStudyAnswer(store: AnswerStore, scope: StudyScope, answer: StudyAnswer) {
  try { store.setItem(key(scope, answer.learnerId), JSON.stringify(answer)); return true; }
  catch { return false; }
}

export function forgetStudyAnswer(store: AnswerStore, scope: StudyScope, answer: StudyAnswer) {
  try {
    // An older, unmounted page must not remove a newer answer's recovery record.
    if (readStudyAnswer(store, scope, answer.learnerId)?.requestId === answer.requestId) store.removeItem(key(scope, answer.learnerId));
  } catch { /* In-memory pending state remains authoritative for this mounted page. */ }
}
