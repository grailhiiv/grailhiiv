import type { Metadata } from "next";
import { WorkspaceProvider } from "@/components/workspace-provider";
import { Shell } from "@/components/shell";
import "./globals.css";
import "./mockup.css";
import "./reference-responsive.css";
import "./responsive.css";
import "./auth.css";
import "./automations.css";
import "./account-menu.css";
import "./interactions.css";
import "./agent-plan.css";
import "./social.css";
import "./settings.css";
import { hasSupabase } from "@/lib/supabase/config";
export const metadata: Metadata = {
  title: "GrailHiiv",
  description: "Your clients, content and leads in one place.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <WorkspaceProvider
          demoLogoutUrl={new URL(
            "/login",
            process.env.GRAILHIIV_SITE_URL || "http://127.0.0.1:3100",
          ).toString()}
          mode={
            hasSupabase()
              ? "cloud"
              : process.env.GRAILHIIV_DEMO_MODE === "true" ||
                  process.env.NODE_ENV === "development"
                ? "demo"
                : "setup"
          }
        >
          <Shell>{children}</Shell>
        </WorkspaceProvider>
      </body>
    </html>
  );
}
