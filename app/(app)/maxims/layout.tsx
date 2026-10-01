import { ModuleGate } from "@/components/module-gate";

export default function MaximsLayout({ children }:{children:React.ReactNode}) {
  return <ModuleGate moduleKey="family_maxims">{children}</ModuleGate>;
}
