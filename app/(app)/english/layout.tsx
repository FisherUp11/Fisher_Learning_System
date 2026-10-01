import { ModuleGate } from "@/components/module-gate";
export default function Layout({ children }: { children: React.ReactNode }) { return <ModuleGate moduleKey="adult_english">{children}</ModuleGate>; }
