"use client";

import { useActionState, useState } from "react";
import { createWorkspaceInvitation, type AdminActionState } from "@/lib/admin-actions";

const initialState: AdminActionState = { status: "idle", message: "" };

export function AdminInviteForm() {
  const [state, action, pending] = useActionState(createWorkspaceInvitation, initialState);
  const [copied, setCopied] = useState(false);
  async function copyInvitation() {
    if (!state.invitationPath) return;
    await navigator.clipboard.writeText(`${window.location.origin}${state.invitationPath}`);
    setCopied(true);
  }

  return <form action={action} className="form-grid admin-invite-form">
    <label>家长邮箱<input name="email" type="email" required placeholder="parent@example.com" /></label>
    <label>家庭名称<input name="family_name" required maxLength={80} placeholder="例如：Hudson 的家" /></label>
    <button className="primary" type="submit" disabled={pending}>{pending ? "生成中…" : "生成邀请链接"}</button>
    {state.message && <p className={state.status === "error" ? "error" : "success"}>{state.message}</p>}
    {state.invitationPath && <div className="invite-result"><code>{state.invitationPath}</code><button className="secondary" type="button" onClick={copyInvitation}>{copied ? "已复制" : "复制完整链接"}</button></div>}
  </form>;
}
