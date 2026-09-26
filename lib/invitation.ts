export function validInvitationToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function safeNextPath(value: string | null | undefined, fallback = "/learn") {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value)) return fallback;
  return value;
}

export function invitationError(message: string) {
  if (/digest|sha256|function .*does not exist/i.test(message)) return "邀请服务需要升级，请让 owner 运行 021 数据库修复脚本，再用此链接重试。";
  if (/邀请|邮箱|空间|停用|登录|验证/.test(message) && message.length < 180) return message;
  return "暂时未能确认邀请，链接仍保留，请稍后重试；若一直失败，请联系 owner 检查 021 数据库升级。";
}
