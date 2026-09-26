"use client";

import { useActionState, useState } from "react";
import { createWorkspaceInvitation, type AdminActionState } from "@/lib/admin-actions";

const initialState: AdminActionState = { status: "idle", message: "" };

export function AdminInviteForm() {
  const [state, action, pending] = useActionState(createWorkspaceInvitation, initialState);
  const [copied, setCopied] = useState("");
  async function copyInvitation() {
    if (!state.invitationPath) return;
    try { await navigator.clipboard.writeText(`${window.location.origin}${state.invitationPath}`); setCopied("已复制完整链接"); }
    catch { setCopied("复制失败，请右键复制链接地址"); }
  }

  return <form action={action} className="form-grid admin-invite-form">
    <label>家长邮箱<input name="email" type="email" required placeholder="parent@example.com" /></label>
    <label>家庭名称<input name="family_name" required maxLength={80} placeholder="例如：Hudson 的家" /></label>
    <button className="primary" type="submit" disabled={pending}>{pending ? "生成中…" : "生成邀请链接"}</button>
    {state.message && <p className={state.status === "error" ? "error" : "success"}>{state.message}</p>}
    {state.invitationPath && <div className="invite-result"><code>{state.invitationPath}</code><a className="text-button" href={state.invitationPath} target="_blank" rel="noreferrer">打开邀请页</a><button className="secondary" type="button" onClick={copyInvitation}>复制完整链接</button><small role="status">{copied}</small></div>}
  </form>;
}
