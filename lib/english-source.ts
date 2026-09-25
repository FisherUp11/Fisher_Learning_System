/** Pure, conservative subtitle preparation. Original text is never rewritten in storage. */
export type SourcePair = { english: string; chinese: string };
type Run = { start: number; end: number; text: string; language: "en" | "zh" | "mixed"; group: number };
type Unit = { start: number; end: number; english: string; chinese: string; paired: boolean };
const timing = /^(?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3}\s*-->\s*(?:\d{1,3}:)?\d{2}:\d{2}[.,]\d{3}(?:\s+.*)?$/;
const words = (text: string) => (text.match(/[A-Za-z]+(?:['’\-][A-Za-z]+)*|\d+(?:[.,]\d+)*/g) ?? []).length;

export function prepareEnglishSource(raw: string) {
  const lines = raw.split(/\n/); const runs: Run[] = [];
  const nextNonempty: string[] = new Array(lines.length); let following = "";
  for (let i = lines.length - 1; i >= 0; i--) { nextNonempty[i] = following; if (lines[i].trim()) following = lines[i].trim(); }
  let offset = 0, group = 0, removedLines = 0, mixedLines = 0, note = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], start = offset; offset += line.length + (i < lines.length - 1 ? 1 : 0);
    const original = line.replace(/^\uFEFF/, "").trim();
    if (!original) { group++; note = false; continue; }
    if (/^(?:NOTE(?:\s|$)|STYLE$|REGION$)/.test(original)) note = true;
    const next = nextNonempty[i];
    const cueId = timing.test(next) && /^(?:\d+|cue[-_\w]*)$/i.test(original);
    if (note || /^WEBVTT(?:\s|$)/.test(original) || timing.test(original) || cueId) {
      removedLines++; if (timing.test(original)) group++; continue;
    }
    // Only known subtitle formatting tags, never a generic HTML parser or executable markup.
    const text = original.replace(/<\/?(?:i|b|u|c)(?:[.\s][^>]*)?>/gi, "").replace(/<\/?v(?:\s[^>]*)?>/gi, "")
      .replace(/<(?:\d{2}:)?\d{2}:\d{2}\.\d{3}>/g, "")
      .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, e => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " " })[e]!)
      .replace(/^(?:English|英文|中文|Chinese)\s*[:：]\s*/i, "").trim();
    if (!text) continue;
    const han = /\p{Script=Han}/u.test(text), latin = /[A-Za-z]/.test(text);
    if (!han && !latin) { // Numeric-only content is retained with the preceding language, not silently deleted.
      const prev = runs.at(-1); if (prev && prev.group === group) { prev.text += ` ${text}`; prev.end = offset; }
      continue;
    }
    const language = han ? latin && words(text) >= 4 ? "mixed" : "zh" : "en";
    if (language === "mixed") mixedLines++;
    const previous = runs.at(-1);
    if (previous?.language === language && previous.group === group) { previous.text += ` ${text}`; previous.end = offset; }
    else runs.push({ start, end: offset, text, language, group });
  }
  const units: Unit[] = [];
  // Pair adjacent language runs in either direction, but never pair across a cue/paragraph
  // containing its own bilingual content. Separate EN and ZH paragraphs may also be paired.
  const groupLanguages = new Map<number, Set<string>>();
  for (const run of runs) { if (!groupLanguages.has(run.group)) groupLanguages.set(run.group, new Set()); groupLanguages.get(run.group)!.add(run.language); }
  for (let i = 0; i < runs.length; i++) {
    const a = runs[i], b = runs[i + 1];
    const opposite = b && a.language !== "mixed" && b.language !== "mixed" && a.language !== b.language;
    const samePairGroup = b && (a.group === b.group || groupLanguages.get(a.group)!.size === 1 && groupLanguages.get(b.group)!.size === 1);
    if (opposite && samePairGroup) {
      units.push({ start: a.start, end: b.end, english: a.language === "en" ? a.text : b.text, chinese: a.language === "zh" ? a.text : b.text, paired: true }); i++;
    } else units.push({ start: a.start, end: a.end, english: a.language === "en" ? a.text : "", chinese: a.language !== "en" ? a.text : "", paired: false });
  }
  const pairs: SourcePair[] = units.filter(u => u.paired).map(u => ({ english: u.english, chinese: u.chinese }));
  const english = units.map(u => u.english).filter(Boolean).join("\n\n");
  const chinese = units.map(u => u.chinese).filter(Boolean).join("\n\n");
  const warnings: string[] = [];
  if (mixedLines) warnings.push("有同一行中英混排，无法可靠识别；请把英文和中文分成相邻两行。");
  if (chinese && !pairs.length) warnings.push("没有识别到相邻双语对照；请检查预览，英文为学习主体，中文仅供参考。");
  if (pairs.length && units.some(u => !u.paired)) warnings.push("有未配对的内容（例如标题或单语段落），已保留原稿，请核对预览。");
  if (!english.trim()) warnings.push("尚未找到独立英文行，请调整为一行英文、一行中文后再生成课程。");
  // Contiguous original slices retain even removed cue metadata, in original order.
  const rawUnits = units.map((u, i) => raw.slice(i === 0 ? 0 : u.start, units[i + 1]?.start ?? raw.length).trim());
  return { english, chinese, pairs, englishWords: words(english), removedLines, warnings, rawUnits, bilingual: !!chinese && !!english };
}

export function listeningSourceInput(raw: string) {
  const prepared = prepareEnglishSource(raw);
  if (prepared.englishWords < 80) throw new Error("本节有效英文不足 80 词，请合并相邻字幕内容后导入；不会把中文扩写成不存在的英文事实。");
  return { english_source: prepared.english, chinese_reference: prepared.chinese, bilingual_pairs: prepared.pairs, source_kind: prepared.bilingual ? "bilingual" : "english" };
}
