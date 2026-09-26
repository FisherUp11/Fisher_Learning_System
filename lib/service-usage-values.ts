export type ServiceKind = "text" | "image" | "tts" | "stt";
function count(value: unknown) { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null; }
export function usageValues(payload: unknown, service: ServiceKind) {
  const p = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const u = p.usage && typeof p.usage === "object" ? p.usage as Record<string, unknown> : {};
  const details = (u.prompt_tokens_details ?? u.input_tokens_details) as { cached_tokens?: unknown } | undefined;
  return {
    input_tokens: count(u.prompt_tokens ?? u.input_tokens),
    output_tokens: count(u.completion_tokens ?? u.output_tokens),
    cached_input_tokens: count(details?.cached_tokens),
    images: service === "image" && Array.isArray(p.data) ? p.data.filter(x => x && typeof x === "object" && ("b64_json" in x || "url" in x)).length : 0,
  };
}
