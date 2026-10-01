import "server-only";
import type { ServiceKind } from "@/lib/service-usage-values";

type Limits = { workspaceMinute: number; accountMinute: number; workspaceDay: number; accountDay: number; workspaceUnitsDay: number | null; accountUnitsDay: number | null };

// Conservative defaults, especially for an Azure Speech F0 resource. Set the real
// deployment limits in Vercel after checking Azure; these are app limits, not Azure quotas.
const defaults: Record<ServiceKind, Limits> = {
  text: { workspaceMinute: 10, accountMinute: 3, workspaceDay: 300, accountDay: 30, workspaceUnitsDay: null, accountUnitsDay: null },
  image: { workspaceMinute: 2, accountMinute: 1, workspaceDay: 100, accountDay: 8, workspaceUnitsDay: null, accountUnitsDay: null },
  tts: { workspaceMinute: 15, accountMinute: 6, workspaceDay: 1500, accountDay: 300, workspaceUnitsDay: 50_000, accountUnitsDay: 5_000 },
  stt: { workspaceMinute: 5, accountMinute: 2, workspaceDay: 120, accountDay: 20, workspaceUnitsDay: 3_600, accountUnitsDay: 300 },
};

function positiveInteger(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 1 && value <= 1_000_000 ? value : fallback;
}

export function serviceGuardLimits(service: ServiceKind): Limits {
  const upper = service.toUpperCase();
  const base = defaults[service];
  return {
    workspaceMinute: positiveInteger(`AZURE_GUARD_${upper}_WORKSPACE_RPM`, base.workspaceMinute),
    accountMinute: positiveInteger(`AZURE_GUARD_${upper}_ACCOUNT_RPM`, base.accountMinute),
    workspaceDay: positiveInteger(`AZURE_GUARD_${upper}_WORKSPACE_DAY`, base.workspaceDay),
    accountDay: positiveInteger(`AZURE_GUARD_${upper}_ACCOUNT_DAY`, base.accountDay),
    workspaceUnitsDay: base.workspaceUnitsDay === null ? null : positiveInteger(`AZURE_GUARD_${upper}_WORKSPACE_${service === "tts" ? "CHARS" : "SECONDS"}_DAY`, base.workspaceUnitsDay),
    accountUnitsDay: base.accountUnitsDay === null ? null : positiveInteger(`AZURE_GUARD_${upper}_ACCOUNT_${service === "tts" ? "CHARS" : "SECONDS"}_DAY`, base.accountUnitsDay),
  };
}

export function guardDenialMessage(reason: string) {
  if (reason.endsWith("minute")) return "刚才使用 AI / 语音的人较多，请稍后再试。汉字朗读会自动使用设备语音。";
  return "今天的 AI / 语音保护额度已用完；其他学习和打卡仍可继续。请联系管理员查看用量报表。";
}
