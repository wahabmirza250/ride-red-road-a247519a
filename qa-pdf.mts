import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const path = "80d41a30-511f-4f43-b8a4-047115469a36/214137ae-83d0-492e-9e90-06a4ca5f3bc2.pdf";
const { data, error } = await admin.storage.from("state-pdfs").download(path);
if (error) throw error;
await Bun.write("/tmp/rt/round.pdf", await data.arrayBuffer());
console.log("ok");
