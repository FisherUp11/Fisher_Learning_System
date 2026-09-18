import { notFound } from "next/navigation";
import { AdultHub } from "@/components/adult-hub";
export const metadata = { title: "一起坚持 · 字芽" };
export default async function TogetherPage({ params }: { params: Promise<{ section?: string[] }> }) {
  const { section } = await params; const tab = section?.[0] ?? "today";
  if ((section?.length ?? 0) > 1 || !["today", "records", "settings"].includes(tab)) notFound();
  return <AdultHub area="exercise" tab={tab} />;
}
