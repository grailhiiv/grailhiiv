import { notFound } from "next/navigation";
import { WorkspaceScreen } from "@/components/workspace-screen";
import { sections, type Section } from "@/lib/types";
export function generateStaticParams() {
  return sections
    .filter((s) => s !== "overview")
    .map((section) => ({ section }));
}
export default async function Page({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!sections.includes(section as Section)) notFound();
  return <WorkspaceScreen section={section as Section} />;
}
