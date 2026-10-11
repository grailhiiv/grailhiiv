import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./supabase/config";
export function automationService() {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret)
    throw new Error("Automation worker credentials are not configured.");
  return createClient(supabaseConfig().url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
