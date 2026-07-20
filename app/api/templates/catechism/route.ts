const template = `item_key,sequence,section,question_zh,question_en,answer_zh,answer_en,scripture_reference,parent_note
child_q001,1,第一部分,"请填写第一个中文问题","Please enter the first English question","请填写中文答案","Please enter the English answer","经文出处（可选）","家长备注（可选）"
child_q002,2,第一部分,"请填写第二个中文问题","Please enter the second English question","请填写中文答案","Please enter the English answer",,
`;

export function GET() {
  return new Response(`\uFEFF${template}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=catechism-template.csv; filename*=UTF-8''%E5%84%BF%E7%AB%A5%E4%BF%A1%E4%BB%B0%E9%97%AE%E7%AD%94%E6%A8%A1%E6%9D%BF.csv",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
