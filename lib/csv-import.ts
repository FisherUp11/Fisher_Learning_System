import { createHash } from "node:crypto";
import { ImportProblem } from "@/lib/import-safety";

export type ImportKind = "characters" | "poems" | "catechism" | "kids_english";

type Column = { key: string; label: string; required: boolean; aliases: string[]; hint: string };

const col = (key: string, label: string, required: boolean, hint: string, aliases: string[] = []): Column => ({ key, label, required, hint, aliases: [label, ...aliases] });

export const IMPORT_COLUMNS: Record<ImportKind, Column[]> = {
  characters: [
    col("character", "汉字", true, "必填，每行只填 1 个汉字", ["字"]),
    col("pinyin_marked", "拼音", true, "必填，带声调，如 rén；多音字只填本册要学的读音"),
    col("meaning", "释义", true, "必填，给孩子看的简短意思，最多 100 字", ["意思"]),
    col("word_1", "词语1", false, "可选，组词，如 大人", ["组词1"]),
    col("word_2", "词语2", false, "可选，第二个组词", ["组词2"]),
    col("example_sentence", "例句", false, "可选，一句简单例句"),
    col("sequence", "顺序", false, "可选，正整数，决定学习先后；留空按行号排序", ["序号"]),
  ],
  poems: [
    col("poem_key", "编号", false, "可选，英文/数字/下划线；留空时系统自动生成，同一首诗再次导入会自动识别", ["诗词编号"]),
    col("title", "标题", true, "必填，诗名", ["诗名", "题目"]),
    col("author", "作者", true, "必填，佚名也请填写“佚名”"),
    col("dynasty", "朝代", false, "可选，如 唐、宋"),
    col("content", "正文", true, "必填；每句换一行（单元格内 Alt+Enter），或用 \\n 分隔", ["内容", "诗句"]),
    col("sequence", "顺序", false, "可选，正整数；留空按行号排序", ["序号"]),
  ],
  catechism: [
    col("item_key", "编号", true, "必填，英文/数字/下划线，如 q001", ["问题编号"]),
    col("sequence", "顺序", true, "必填，正整数，不能重复", ["序号"]),
    col("section", "章节", false, "可选，如 第一部分"),
    col("question_zh", "中文问题", true, "必填"),
    col("question_en", "英文问题", true, "必填"),
    col("answer_zh", "中文答案", true, "必填"),
    col("answer_en", "英文答案", true, "必填"),
    col("scripture_reference", "出处", false, "可选，参考出处", ["参考"]),
    col("parent_note", "家长备注", false, "可选，只给家长看", ["备注"]),
  ],
  kids_english: [
    col("word", "单词", true, "必填，如 circle；同一字册不重复"),
    col("phonetic", "音标", true, "必填，如 /ˈsɜː.kəl/；不要求 IPA 完全标准"),
    col("meaning_zh", "中文意思", true, "必填，简短明确"),
    col("example_en", "英文例句", true, "必填，适合孩子跟读"),
    col("example_zh", "例句中文", false, "可选，帮助理解"),
    col("part_of_speech", "词性", false, "可选，如 noun、verb"),
    col("sequence", "顺序", false, "可选，正整数；留空按 CSV 行顺序"),
  ],
};

const TEMPLATE_EXAMPLES: Record<ImportKind, string[][]> = {
  characters: [
    ["人", "rén", "人；我们都是人", "大人", "人家", "爸爸是大人。", "1"],
    ["口", "kǒu", "嘴；用嘴说话", "开口", "门口", "我开口说你好。", "2"],
  ],
  poems: [
    ["tang_jingyesi", "静夜思", "李白", "唐", "床前明月光\n疑是地上霜\n举头望明月\n低头思故乡", "1"],
    ["", "咏鹅", "骆宾王", "唐", "鹅，鹅，鹅\n曲项向天歌\n白毛浮绿水\n红掌拨清波", "2"],
  ],
  catechism: [
    ["q001", "1", "第一部分", "请填写第一个中文问题", "Please enter the first English question", "请填写中文答案", "Please enter the English answer", "", ""],
    ["q002", "2", "第一部分", "请填写第二个中文问题", "Please enter the second English question", "请填写中文答案", "Please enter the English answer", "", ""],
  ],
  kids_english: [
    ["circle", "/ˈsɜː.kəl/", "圆形；圆圈", "This is a circle.", "这是一个圆形。", "noun", "1"],
    ["triangle", "/ˈtraɪ.æŋ.ɡəl/", "三角形", "I can see a triangle.", "我看见一个三角形。", "noun", "2"],
  ],
};

const TEMPLATE_NAMES: Record<ImportKind, string> = { characters: "汉字导入模板", poems: "古诗词导入模板", catechism: "要理问答导入模板", kids_english: "儿童英语单词导入模板" };

const csvCell = (value: string) => /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

export function buildImportTemplate(kind: ImportKind) {
  const columns = IMPORT_COLUMNS[kind];
  const notes = [
    `# ${TEMPLATE_NAMES[kind]}：以 # 开头的说明行导入时会自动忽略，可以保留也可以删除。`,
    "# 保存方式：Excel/WPS 选“CSV UTF-8（逗号分隔）”；普通“CSV”也可以，系统会自动识别中文编码。不要上传 .xlsx。",
    "# 表头行（带中文括号的那一行）不要改动；列的先后顺序可以调整，也可以删掉不用的可选列。",
    ...columns.map((column) => `# ${column.key}（${column.label}）：${column.hint}`),
    "# 下面两行是示例，确认后可以直接改成自己的内容。上传后若有问题，系统会列出具体行号和原因，并且不会导入任何内容。",
  ];
  const header = columns.map((column) => `${column.key}（${column.label}）`);
  const lines = [...notes.map((note) => [note]), header, ...TEMPLATE_EXAMPLES[kind]].map((row) => row.map(csvCell).join(","));
  return new Response(`\uFEFF${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=${kind}-template.csv; filename*=UTF-8''${encodeURIComponent(TEMPLATE_NAMES[kind])}.csv`,
      "Cache-Control": "public, max-age=600",
    },
  });
}

export async function readCsvUpload(file: FormDataEntryValue | null, maxBytes: number) {
  if (!(file instanceof File) || file.size === 0) throw new ImportProblem("请选择要上传的 CSV 文件");
  if (file.size > maxBytes) throw new ImportProblem(`CSV 请控制在 ${Math.round(maxBytes / 1_000_000)}MB 内，内容多时可以拆成几份分别导入`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) throw new ImportProblem("这是 Excel（.xlsx）文件。请在 Excel/WPS 里“另存为 → CSV UTF-8（逗号分隔）”后再上传");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    // Chinese Excel on Windows saves plain "CSV" as GBK.
    return new TextDecoder("gb18030").decode(bytes);
  }
}

type CsvRecord = { line: number; cells: string[] };

function parseCsvRecords(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let recordStart = 1;
  const push = () => {
    row.push(cell.trim());
    if (row.some(Boolean)) records.push({ line: recordStart, cells: row });
    row = [];
    cell = "";
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; continue; }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      push();
      line += 1;
      recordStart = line;
      continue;
    }
    cell += char;
  }
  if (quoted) throw new ImportProblem(`从第 ${recordStart} 行开始有未闭合的英文双引号 "，请检查该行内容`);
  push();
  return records;
}

const normalizeHeader = (value: string) => value.replace(/^\uFEFF/, "").split(/[（(]/)[0].trim().toLowerCase().replace(/\s+/g, "_");

export type ImportRow = { line: number; get: (key: string) => string };

/** Parses a template-shaped CSV; # rows are instructions and are ignored. */
export function readImportTable(text: string, kind: ImportKind, maxRows: number) {
  const columns = IMPORT_COLUMNS[kind];
  const records = parseCsvRecords(text).filter((record) => !record.cells[0]?.startsWith("#"));
  const [headerRecord, ...dataRecords] = records;
  if (!headerRecord) throw new ImportProblem("文件是空的：请先填写表头和至少一行内容");
  const lookup = new Map<string, string>();
  for (const column of columns) for (const name of [column.key, ...column.aliases]) lookup.set(normalizeHeader(name), column.key);
  const positions = new Map<string, number>();
  headerRecord.cells.forEach((header, index) => {
    const key = lookup.get(normalizeHeader(header));
    if (key && !positions.has(key)) positions.set(key, index);
  });
  const missing = columns.filter((column) => column.required && !positions.has(column.key));
  if (missing.length) {
    throw new ImportProblem("表头不正确，没有导入任何内容。", [
      `第 ${headerRecord.line} 行应是表头，缺少必填列：${missing.map((column) => `${column.key}（${column.label}）`).join("、")}`,
      `当前表头是：${headerRecord.cells.filter(Boolean).join("、") || "（空）"}`,
      "建议重新下载模板，把内容粘贴到模板对应列里。",
    ]);
  }
  if (!dataRecords.length) throw new ImportProblem("表头下面还没有内容，请至少填写一行");
  if (dataRecords.length > maxRows) throw new ImportProblem(`一次最多导入 ${maxRows} 行，当前有 ${dataRecords.length} 行。请拆成几份分别导入`);
  return dataRecords.map<ImportRow>((record) => ({
    line: record.line,
    get: (key) => {
      const position = positions.get(key);
      return position === undefined ? "" : (record.cells[position] ?? "").trim();
    },
  }));
}

export class ImportIssues {
  private issues: string[] = [];
  add(line: number, message: string) { this.issues.push(`第 ${line} 行：${message}`); }
  /** Blocks the whole import so no partial data is written. */
  throwIfAny() {
    if (!this.issues.length) return;
    const shown = this.issues.slice(0, 40);
    if (this.issues.length > shown.length) shown.push(`……另外还有 ${this.issues.length - shown.length} 处问题，改完上面这些后再上传即可看到。`);
    throw new ImportProblem(`发现 ${this.issues.length} 处问题，本次没有导入任何内容。请按下面的行号修改后重新上传。`, shown);
  }
}

export function checkSequence(issues: ImportIssues, row: ImportRow, fallback: number, seen: Map<number, number>, required = false) {
  const raw = row.get("sequence");
  if (!raw && !required) return fallback;
  const value = Number(raw);
  if (!raw || !Number.isInteger(value) || value < 1 || value > 100000) {
    issues.add(row.line, `顺序“${raw || "空"}”必须是 1 到 100000 之间的整数${required ? "" : "（也可以留空）"}`);
    return fallback;
  }
  const firstLine = seen.get(value);
  if (firstLine !== undefined) issues.add(row.line, `顺序 ${value} 与第 ${firstLine} 行重复`);
  else seen.set(value, row.line);
  return value;
}

export function checkLength(issues: ImportIssues, row: ImportRow, label: string, value: string | null, max: number) {
  if (value && value.length > max) issues.add(row.line, `${label}最多 ${max} 字，当前 ${value.length} 字`);
}

export const STABLE_KEY = /^[a-zA-Z0-9_-]{1,100}$/;

export function derivedPoemKey(identity: string) {
  return `p_${createHash("sha256").update(identity).digest("hex").slice(0, 16)}`;
}
