import { createClient } from "@supabase/supabase-js";

export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  }

  try {
    const client = createClient(url, key, {
      auth: { persistSession: false },
    });
    return client;
  } catch (err) {
    throw new Error(`Failed to create Supabase client: ${err.message}`);
  }
}
