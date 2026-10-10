import { hasSupabase } from "@/lib/supabase/config";
export function GET() {
  return Response.json({
    status: "ok",
    mode: hasSupabase() ? "supabase" : "local-demo",
    integrationsConnected: hasSupabase(),
    aiConnected: false,
    publishingConnected: false,
  });
}
