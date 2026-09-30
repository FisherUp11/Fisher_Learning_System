import "server-only";

const envNumber = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

/** Planning estimates in USD; override via env when list prices or plans change. Not a bill. */
export function loadCostModel() {
  return {
    usdToCny: envNumber("COST_USD_TO_CNY", 7.2),
    fixedMonthlyUsd: {
      vercelPro: envNumber("COST_VERCEL_PRO_MONTHLY_USD", 20),
      supabasePro: envNumber("COST_SUPABASE_PRO_MONTHLY_USD", 25),
      r2: envNumber("COST_R2_MONTHLY_USD", 1),
      other: envNumber("COST_OTHER_MONTHLY_USD", 0),
    },
    textInputPerM: envNumber("COST_TEXT_INPUT_PER_M_USD", 2),
    textCachedInputPerM: envNumber("COST_TEXT_CACHED_INPUT_PER_M_USD", 0.5),
    textOutputPerM: envNumber("COST_TEXT_OUTPUT_PER_M_USD", 8),
    imageInputPerM: envNumber("COST_IMAGE_INPUT_PER_M_USD", 2),
    imageOutputPerM: envNumber("COST_IMAGE_OUTPUT_PER_M_USD", 8),
    imageFallbackEach: envNumber("COST_IMAGE_FALLBACK_EACH_USD", 0.01),
    ttsPerMChars: envNumber("COST_TTS_PER_M_CHARS_USD", 15),
    sttPerHour: envNumber("COST_STT_PER_HOUR_USD", 1),
  };
}

export type CostModel = ReturnType<typeof loadCostModel>;

export type UsageRow = {
  service: string;
  requests: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_input_tokens: number | null;
  characters: number;
  images: number;
  audio_seconds: number;
};

/** Failed or unknown requests are counted too: providers may still bill them. */
export function variableCostUsd(row: UsageRow, model: CostModel) {
  const n = (value: number | null) => Number(value ?? 0);
  if (row.service === "text") {
    const cached = n(row.cached_input_tokens);
    return ((n(row.input_tokens) - cached) * model.textInputPerM + cached * model.textCachedInputPerM + n(row.output_tokens) * model.textOutputPerM) / 1_000_000;
  }
  if (row.service === "image") {
    const byTokens = (n(row.input_tokens) * model.imageInputPerM + n(row.output_tokens) * model.imageOutputPerM) / 1_000_000;
    return byTokens > 0 ? byTokens : Math.max(n(row.images), n(row.requests)) * model.imageFallbackEach;
  }
  if (row.service === "tts") return n(row.characters) * model.ttsPerMChars / 1_000_000;
  if (row.service === "stt") return n(row.audio_seconds) / 3600 * model.sttPerHour;
  return 0;
}

export function fixedMonthlyUsd(model: CostModel) {
  const fixed = model.fixedMonthlyUsd;
  return fixed.vercelPro + fixed.supabasePro + fixed.r2 + fixed.other;
}
