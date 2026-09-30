export type LearnerChoice = { id: string; display_name: string; family_id?: string | null; families?: unknown };

export function familyNameOf(learner: LearnerChoice) {
  const family = learner.families as { name?: string } | Array<{ name?: string }> | null | undefined;
  return (Array.isArray(family) ? family[0]?.name : family?.name) ?? "";
}

/** Own family first, then other families alphabetically; creation order kept inside a family. */
export function orderLearners<T extends LearnerChoice>(learners: T[] | null | undefined, ownFamilyId: string | null | undefined): T[] {
  const list = [...(learners ?? [])];
  const index = new Map(list.map((learner, position) => [learner.id, position]));
  return list.sort((a, b) => {
    const ownA = a.family_id && a.family_id === ownFamilyId ? 0 : 1;
    const ownB = b.family_id && b.family_id === ownFamilyId ? 0 : 1;
    if (ownA !== ownB) return ownA - ownB;
    const byFamily = familyNameOf(a).localeCompare(familyNameOf(b), "zh-CN");
    return byFamily || (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0);
  });
}

/** Renders <option>s, grouped by family when more than one family is visible. */
export function LearnerOptions({ learners, label }: { learners: LearnerChoice[]; label?: (learner: LearnerChoice) => string }) {
  const text = label ?? ((learner: LearnerChoice) => learner.display_name);
  const groups = new Map<string, LearnerChoice[]>();
  for (const learner of learners) {
    const key = learner.family_id ?? familyNameOf(learner);
    groups.set(key, [...(groups.get(key) ?? []), learner]);
  }
  if (groups.size <= 1) return <>{learners.map((learner) => <option key={learner.id} value={learner.id}>{text(learner)}</option>)}</>;
  return <>{[...groups.values()].map((members) => <optgroup key={members[0].id} label={`${familyNameOf(members[0]) || "未命名家庭"}（${members.length}）`}>
    {members.map((learner) => <option key={learner.id} value={learner.id}>{text(learner)}</option>)}
  </optgroup>)}</>;
}
