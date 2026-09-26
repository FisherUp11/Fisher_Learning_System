"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  changeInitialPassword,
  createWorkspaceUser,
  resetWorkspaceUserPassword,
  updateWorkspaceUser,
  type UserManagementState,
} from "@/lib/user-management-actions";

const initialState: UserManagementState = { status: "idle", message: "" };

type FamilyOption = { id: string; name: string };
type ChildPulse = { id: string; name: string; stable: number; due: number; todayRemaining: number };

function ResultNotice({ state }: { state: UserManagementState }) {
  const [copyMessage, setCopyMessage] = useState("");
  if (state.status === "idle") return null;
  return <div className={state.status === "error" ? "form-error" : "success-box"} role="status">
    <strong>{state.message}</strong>
    {state.temporaryPassword && <div className="temporary-credential"><span>{state.email}</span><code>{state.temporaryPassword}</code><button type="button" className="text-button" onClick={async () => {
      try { await navigator.clipboard.writeText(`登录地址：${window.location.origin}/login\n邮箱：${state.email}\n临时密码：${state.temporaryPassword}\n首次登录请设置自己的新密码，请勿转发。`); setCopyMessage("已复制，请通过私密渠道发给本人"); }
      catch { setCopyMessage("复制失败，请手动复制上方邮箱和密码"); }
    }}>复制登录信息</button><small role="status">{copyMessage}</small></div>}
  </div>;
}

export function OwnerUserCreateForm({ families }: { families: FamilyOption[] }) {
  const [state, action, pending] = useActionState(createWorkspaceUser, initialState);
  const [role, setRole] = useState("parent");
  return <form action={action} className="admin-user-form" onSubmit={e => { if (!confirm("确认已核对朋友邮箱并获得同意？系统将创建登录账号和随机临时密码，不自动发送邮件。")) e.preventDefault(); }}>
    <div className="field-grid"><label>登录邮箱<input name="email" type="email" autoComplete="off" placeholder="parent@example.com" required /></label><label>账号称呼（可不填）<input name="display_name" placeholder="默认使用邮箱前缀" maxLength={80} /></label></div>
    <label>角色<select name="role" value={role} onChange={(event) => setRole(event.target.value)}><option value="parent">家长</option><option value="admin">管理员</option></select></label>
    {role === "parent" && <div className="field-grid"><label>加入已有家庭<select name="family_id" defaultValue=""><option value="">不选择，创建新家庭</option>{families.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}</select></label><label>新家庭名称<input name="new_family_name" placeholder="没有选择已有家庭时填写" maxLength={80} /></label></div>}
    <p className="helper-text">只填邮箱也可以，家庭名称留空会自动生成。系统生成随机临时密码，只在本次成功结果中显示；请私下交给本人，首次登录必须更换。已有账号请用邀请，不覆盖原密码。</p>
    <button className="primary" disabled={pending}>{pending ? "正在创建账号…" : "创建账号"}</button>
    <ResultNotice state={state} />
  </form>;
}

export function OwnerUserCard({ member, families, childPulses }: {
  member: { userId: string; email: string; displayName: string; role: string; status: string; familyId: string | null; mustChangePassword: boolean; lastSignInLabel: string; isOwner: boolean };
  families: FamilyOption[];
  childPulses: ChildPulse[];
}) {
  const [updateState, updateAction, updatePending] = useActionState(updateWorkspaceUser, initialState);
  const [resetState, resetAction, resetPending] = useActionState(resetWorkspaceUserPassword, initialState);
  const [role, setRole] = useState(member.role);
  return <article className="owner-user-card">
    <div className="owner-user-heading"><span className="resource-kind">{member.isOwner ? "主" : member.role === "admin" ? "管" : "家"}</span><div><h3>{member.displayName}</h3><p>{member.email} · {member.isOwner ? "所有者" : member.role === "admin" ? "管理员" : "家长"} · {member.status === "active" ? "正常" : "已停用"}</p><small>最近登录：{member.lastSignInLabel}{member.mustChangePassword ? " · 等待首次修改密码" : ""}</small></div></div>
    {childPulses.length > 0 && <div className="member-child-pulses">{childPulses.map((child) => <div key={child.id}><strong>{child.name}</strong><span>稳定认识 {child.stable}</span><span>到期 {child.due}</span><span>今日剩余 {child.todayRemaining}</span></div>)}</div>}
    {!member.isOwner && <details><summary>修改账号权限与家庭</summary><form action={updateAction} className="admin-user-form compact-form"><input type="hidden" name="user_id" value={member.userId} /><div className="field-grid"><label>账号称呼<input name="display_name" defaultValue={member.displayName} required /></label><label>角色<select name="role" value={role} onChange={(event) => setRole(event.target.value)}><option value="parent">家长</option><option value="admin">管理员</option></select></label></div><div className="field-grid">{role === "parent" ? <label>所属家庭<select name="family_id" defaultValue={member.familyId ?? ""} required><option value="" disabled>请选择家庭</option>{families.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}</select></label> : <span />}<label>状态<select name="status" defaultValue={member.status}><option value="active">正常</option><option value="suspended">停用（保留资料）</option></select></label></div><button className="secondary" disabled={updatePending}>{updatePending ? "保存中…" : "保存账号设置"}</button><ResultNotice state={updateState} /></form>
      <form action={resetAction} className="password-reset-row" onSubmit={e => { if (!confirm(`确认重置 ${member.email} 的密码？原密码将不能用于新的登录。`)) e.preventDefault(); }}><input type="hidden" name="user_id" value={member.userId} /><div><strong>忘记密码？</strong><p>生成新的临时密码，并要求下次登录后重新设置。</p></div><button className="text-button danger" disabled={resetPending}>{resetPending ? "重置中…" : "重置临时密码"}</button></form><ResultNotice state={resetState} />
    </details>}
  </article>;
}

export function InitialPasswordForm() {
  const [state, action, pending] = useActionState(changeInitialPassword, initialState);
  const router = useRouter();
  useEffect(() => { if (state.status === "success") { const timer = window.setTimeout(() => router.replace("/learn"), 500); return () => window.clearTimeout(timer); } }, [router, state.status]);
  return <form action={action} className="login-form"><label>新密码<input name="password" type="password" minLength={12} autoComplete="new-password" required /></label><label>再次输入新密码<input name="password_confirmation" type="password" minLength={12} autoComplete="new-password" required /></label><p className="helper-text">至少 12 位，同时包含字母和数字。请不要继续使用家长收到的临时密码。</p><button className="primary" disabled={pending}>{pending ? "正在设置…" : "保存新密码并进入系统"}</button><ResultNotice state={state} /></form>;
}
