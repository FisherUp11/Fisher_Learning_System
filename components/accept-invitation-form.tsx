"use client";

import { useActionState, useEffect } from "react";
import { acceptWorkspaceInvitation, type AdminActionState } from "@/lib/admin-actions";
import { createClient } from "@/lib/supabase/client";

export function AcceptInvitationForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState(acceptWorkspaceInvitation, { status: "idle", message: "" } as AdminActionState);
  useEffect(() => { if (state.status === "success") window.location.replace("/parent?joined=1"); }, [state.status]);
  return <form action={action} className="form-grid">
    <input type="hidden" name="token" value={token} />
    <p className="notice">当前账号：<strong>{email}</strong><br />请确认是受邀邮箱。加入后家长只管理自己的家庭，公共资源由管理员分配。</p>
    <button className="primary full" disabled={pending || state.status === "success"}>{pending ? "正在确认…" : state.status === "success" ? "已加入，正在进入…" : "确认加入"}</button>
    {state.message && <p role="status" className={state.status === "error" ? "error" : "success"}>{state.message}</p>}
    <button type="button" className="text-button" disabled={pending} onClick={async () => {
      const { error } = await createClient().auth.signOut({ scope: "local" });
      if (!error) window.location.replace(`/login?next=${encodeURIComponent(`/join?token=${token}`)}`);
    }}>不是受邀邮箱？退出并换账号</button>
  </form>;
}
