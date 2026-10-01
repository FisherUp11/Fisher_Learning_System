import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loadAccessContext } from "@/lib/access";
import { loadAccountModules } from "@/lib/module-access";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const access = await loadAccessContext(supabase, user.id);
  if (!access) redirect("/join");
  const modules = await loadAccountModules(supabase, access, user.id);
  const destination = {
    hanzi: "/learn", poem: "/poems", music: "/music", catechism: "/catechism",
    kids_english: "/kids-english", adult_english: "/english", exercise: "/together",
  } as const;
  redirect(modules.length ? destination[modules[0]] : access.isAdmin ? "/admin" : "/parent");
}
