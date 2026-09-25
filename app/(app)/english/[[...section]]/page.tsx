import { notFound } from "next/navigation";
import { AdultHub } from "@/components/adult-hub";
export const metadata = { title: "会议英语 · 字芽" };
export default async function EnglishPage({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params; const tab = section?.[0] ?? "today";
  if ((section?.length ?? 0) > 1 || !["today", "materials", "progress", "legacy", "legacy-materials", "legacy-progress"].includes(tab)) notFound();
  return <AdultHub area="english" tab={tab} />;
}
