"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, useTransition, type CSSProperties, type FormEvent, type ReactNode } from "react";
import styles from "./feedback-form.module.css";
import { useRouter } from "next/navigation";

export type FormFeedback = { status: string; message: string; redirectTo?: string };
const subscribeToHydration = () => () => {};

type Confirmation = {
  title: string;
  description: string;
  confirmLabel?: string;
};

export function FeedbackDialog({ title, message, children, onClose }: {
  title: string;
  message: string;
  children?: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const messageId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} aria-describedby={messageId} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <span className={styles.mark} aria-hidden="true">芽</span>
    <h2 id={titleId}>{title}</h2>
    <p id={messageId} className={styles.description}>{message}</p>
    {children ?? <button type="button" className="primary full" onClick={onClose}>知道了</button>}
  </dialog>;
}

function describeSubmission(form: HTMLFormElement, data: FormData) {
  const summaries: string[] = [];
  const names = ["package_title", "poem_collection_title", "collection_title", "title"];
  for (const name of names) {
    const value = data.get(name);
    if (typeof value === "string" && value.trim()) summaries.push(`名称：${value.trim()}`);
  }
  for (const value of data.values()) {
    if (value instanceof File && value.name) summaries.push(`文件：${value.name}`);
  }
  const learner = form.querySelector<HTMLSelectElement>('select[name="learner_id"]');
  if (learner?.selectedOptions[0]) summaries.push(`孩子：${learner.selectedOptions[0].textContent}`);
  const checked = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="learner_ids"]:checked'));
  if (checked.length) summaries.push(`孩子：${checked.map((input) => input.closest("label")?.textContent?.trim()).filter(Boolean).join("、")}`);
  const publishOption = form.querySelector<HTMLInputElement>('[name="publish_now"]');
  if (publishOption) summaries.push(`发布选项：${data.has("publish_now") ? "立即发布（仍受账号审核权限限制）" : "保存为草稿"}`);
  return summaries.join("\n");
}

/** Keeps the original fields and layout while acknowledging a write immediately. */
export function FeedbackForm({ action, children, className, style, confirm, pendingLabel = "正在保存…", successMessage = "已保存。", successTitle, clearFileOnSuccess = false, resetOnSuccess = false }: {
  action: (data: FormData) => Promise<void | FormFeedback>;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  confirm?: Confirmation;
  pendingLabel?: string;
  successMessage?: string;
  successTitle?: string;
  clearFileOnSuccess?: boolean;
  resetOnSuccess?: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const submitterRef = useRef<HTMLElement | null>(null);
  const hydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const busy = useRef(false);
  const submittedData = useRef<FormData | null>(null);
  const [pending, setPending] = useState(false);
  const [transitionPending, startTransition] = useTransition();
  const [slow, setSlow] = useState(false);
  const [confirmationSummary, setConfirmationSummary] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FormFeedback | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const processing = pending || transitionPending;

  useEffect(() => {
    if (!processing) return;
    const timeout = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(timeout);
  }, [processing]);

  function execute(data: FormData) {
    setConfirmationSummary(null);
    setFeedback(null);
    setResultOpen(false);
    setSlow(false);
    setPending(true);
    startTransition(async () => {
      try {
        const result = await action(data);
        const next = result ?? { status: "success", message: successMessage };
        setFeedback(next);
        if (next.status !== "error") {
          if (resetOnSuccess) formRef.current?.reset();
          if (clearFileOnSuccess) formRef.current?.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach((input) => { input.value = ""; });
          setResultOpen(true);
        }
      } catch (error) {
        setFeedback({ status: "error", message: error instanceof Error ? error.message : "暂时无法确认结果，请刷新查看后再试。" });
      } finally {
        busy.current = false;
        submittedData.current = null;
        setPending(false);
      }
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || processing) return;
    submitterRef.current = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    // Capture before disabling fields, so the complete payload survives errors.
    const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
    busy.current = true;
    if (confirm) {
      submittedData.current = data;
      setConfirmationSummary(describeSubmission(event.currentTarget, data));
    } else execute(data);
  }

  function cancelConfirmation() {
    submittedData.current = null;
    busy.current = false;
    setConfirmationSummary(null);
    requestAnimationFrame(() => submitterRef.current?.focus());
  }

  function closeResult() {
    setResultOpen(false);
    requestAnimationFrame(() => submitterRef.current?.focus());
    if (feedback?.redirectTo?.startsWith("/") && !feedback.redirectTo.startsWith("//")) {
      const target = feedback.redirectTo;
      startTransition(() => router.push(target));
    }
  }

  return <>
    <form ref={formRef} method="post" className={className} style={style} onSubmit={submit} aria-busy={processing || !hydrated}>
      <fieldset className={styles.fields} disabled={processing || !hydrated}>{children}</fieldset>
      {!hydrated && <p className={styles.pending} role="status">正在准备表单…</p>}
      <noscript>请启用浏览器 JavaScript 后再提交，避免重复操作。</noscript>
      {processing && <p className={styles.pending} role="status"><span className={styles.spinner} aria-hidden="true" />{slow ? "仍在处理中，请保持页面打开，无需再次点击。" : pendingLabel}</p>}
      {!processing && feedback && <p className={`${styles.feedback} ${feedback.status === "error" ? "error" : "success"}`} role={feedback.status === "error" ? "alert" : "status"}>{feedback.message}</p>}
    </form>
    {confirmationSummary !== null && confirm && <FeedbackDialog title={confirm.title} message={`${confirmationSummary}${confirmationSummary ? "\n\n" : ""}${confirm.description}`} onClose={cancelConfirmation}>
      <div className={styles.actions}><button type="button" className="secondary" onClick={cancelConfirmation}>再检查一下</button><button type="button" className="primary" onClick={() => { const data = submittedData.current; if (data && !pending) { submittedData.current = null; execute(data); } }}>{confirm.confirmLabel ?? "确认导入"}</button></div>
    </FeedbackDialog>}
    {resultOpen && feedback && <FeedbackDialog title={feedback.status === "duplicate" ? "这份内容已经导入" : successTitle ?? (clearFileOnSuccess ? "导入完成" : "保存成功")} message={feedback.message} onClose={closeResult}>
      <button type="button" className="primary full" onClick={closeResult}>{feedback.redirectTo ? "继续编辑" : "知道了"}</button>
    </FeedbackDialog>}
  </>;
}
