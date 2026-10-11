export type PracticeKind = "poem" | "music" | "catechism";
export type PracticeHistoryRow = { id:string;at:string;localDate:string;score:number|null;result:string|null;stageBefore:number|null;stageAfter:number|null;note:string|null };
export type PracticeHistoryPage = { total:number;page:number;pages:number;rows:PracticeHistoryRow[] };
