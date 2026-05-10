import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envText = readFileSync(join(__dirname, "..", ".env.local"), "utf8");
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const { data: s } = await sb.auth.signUp({ email: `r-${Date.now()}@x.com`, password: "abc12345" });
const uid = s.user.id;
console.log("uid:", uid);

console.log("\n[A] insert WITHOUT .select():");
const r1 = await sb.from("households").insert({ name: "A", owner_id: uid });
console.log("  ", r1.error?.message ?? "OK");

console.log("[B] insert WITH .select('id'):");
const r2 = await sb.from("households").insert({ name: "B", owner_id: uid }).select("id");
console.log("  ", r2.error?.message ?? `OK, ${r2.data?.length} rows`);

console.log("[C] insert WITH .select('id').single():");
const r3 = await sb.from("households").insert({ name: "C", owner_id: uid }).select("id").single();
console.log("  ", r3.error?.message ?? "OK");
