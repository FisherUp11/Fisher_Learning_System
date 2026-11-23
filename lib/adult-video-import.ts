import "server-only";
import { checkLength, ImportIssues, readImportTable } from "@/lib/csv-import";
import { parseVideoTimestamp, type VideoImportRow } from "@/lib/adult-video";

export function parseVideoImport(csv: string): VideoImportRow[] {
  const rows = readImportTable(csv, "adult_video", 200);
  const issues = new ImportIssues();
  const result = rows.map(row => {
    const word = row.get("word").normalize("NFKC");
    const meaning = row.get("meaning");
    const example = row.get("example");
    const pronunciation = row.get("pronunciation");
    if (!/[a-z]/i.test(word)) issues.add(row.line, "单词或短语不能为空，且要包含英文");
    if (!meaning) issues.add(row.line, "请填写中文释义");
    checkLength(issues, row, "单词或短语", word, 160);
    checkLength(issues, row, "释义", meaning, 240);
    checkLength(issues, row, "例句", example, 500);
    checkLength(issues, row, "音标", pronunciation, 80);
    if ([word, meaning, example, pronunciation].some(value => value.includes("\0"))) issues.add(row.line, "含无效字符，请重新保存为 CSV");
    let timestamp: number | null = null;
    try { timestamp = parseVideoTimestamp(row.get("timestamp")); }
    catch (error) { issues.add(row.line, (error as Error).message); }
    return { word, meaning, example, pronunciation, timestamp, track: false };
  });
  issues.throwIfAny();
  return result;
}
