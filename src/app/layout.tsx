import type { Metadata } from "next";
import { WorkspaceProvider } from "@/components/workspace-provider";
import { Shell } from "@/components/shell";
import "./globals.css";
import "./mockup.css";
import "./reference-responsive.css";
import "./responsive.css";
import "./auth.css";
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
