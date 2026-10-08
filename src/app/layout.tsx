import type { Metadata } from "next";
import { WorkspaceProvider } from "@/components/workspace-provider";
import { Shell } from "@/components/shell";
import "./globals.css";
import "./mockup.css";
import "./reference-responsive.css";
import "./responsive.css";
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
        <WorkspaceProvider>
          <Shell>{children}</Shell>
        </WorkspaceProvider>
      </body>
    </html>
  );
}
