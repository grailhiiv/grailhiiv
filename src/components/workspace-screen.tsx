"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { Plus, ArrowDownToLine, Upload } from "lucide-react";
import type { Section, Post } from "@/lib/types";
import { useWorkspace } from "./workspace-provider";
import { PostEditor } from "./post-editor";
import {
  Overview,
  CalendarScreen,
  Approvals,
} from "./screens/content-reference";
const LeadsScreen = dynamic(() =>
  import("./screens/leads").then((m) => m.LeadsScreen),
);
const AutomationsScreen = dynamic(() =>
  import("./screens/automations").then((m) => m.AutomationsScreen),
);
const AssetsScreen = dynamic(() =>
  import("./screens/assets").then((m) => m.AssetsScreen),
);
const ReportsScreen = dynamic(() =>
  import("./screens/reports-reference").then((m) => m.ReportsScreen),
);
const SettingsScreen = dynamic(() =>
  import("./screens/settings").then((m) => m.SettingsScreen),
);
const headings: Record<Section, [string, string]> = {
  overview: ["Overview", "Your clients, content and leads in one place"],
  calendar: [
    "Content calendar",
    "Plan and schedule content across your clients",
  ],
  approvals: ["Approvals", "Review content before it goes live"],
  leads: ["Leads & CRM", "Track prospects and keep follow-ups moving"],
  automations: ["Automations", "Manage workflows and resolve failed runs"],
  assets: ["Asset library", "Organize client images, videos and brand assets"],
  reports: ["Reports", "Understand content performance and lead outcomes"],
  settings: ["Settings", "Manage your workspace and client preferences"],
};
export function WorkspaceScreen({ section }: { section: Section }) {
  const { data, clientId } = useWorkspace();
  const [editor, setEditor] = useState<{ post?: Post; date?: string } | null>(
    null,
  );
  const [addingLead, setAddingLead] = useState(false);
  const [addingAutomation, setAddingAutomation] = useState(false);
  const create = (date = "") => setEditor({ date });
  const edit = (post: Post) => setEditor({ post });
  return (
    <div className={"page page-" + section}>
      <div className="page-heading">
        <div>
          <h1>{headings[section][0]}</h1>
          <p>{headings[section][1]}</p>
        </div>
        <div className="heading-actions">
          {(section === "overview" || section === "calendar") && (
            <button className="button primary" onClick={() => create()}>
              <Plus size={20} />
              Create content
            </button>
          )}
          {section === "leads" && (
            <button
              className="button primary"
              onClick={() => setAddingLead(true)}
            >
              <Plus size={17} />
              Add lead
            </button>
          )}
          {section === "automations" && (
            <button
              className="button primary"
              onClick={() => setAddingAutomation(true)}
            >
              <Plus size={17} />
              New automation
            </button>
          )}
          {section === "assets" && (
            <label className="button primary" htmlFor="asset-upload">
              <Upload size={20} />
              Upload assets
            </label>
          )}
          {section === "reports" && (
            <button
              className="button primary"
              onClick={() => document.getElementById("export-report")?.click()}
            >
              <ArrowDownToLine size={17} />
              Export report
            </button>
          )}
          {section === "approvals" && (
            <span className="pending-label">
              {
                data.posts.filter(
                  (p) =>
                    p.status === "Awaiting approval" &&
                    (clientId === "all" || p.clientId === clientId),
                ).length
              }{" "}
              pending
            </span>
          )}
        </div>
      </div>
      {section === "overview" && <Overview create={create} edit={edit} />}
      {section === "calendar" && <CalendarScreen create={create} edit={edit} />}
      {section === "approvals" && <Approvals edit={edit} />}
      {section === "leads" && (
        <LeadsScreen
          adding={addingLead}
          closeAdd={() => setAddingLead(false)}
        />
      )}
      {section === "automations" && (
        <AutomationsScreen
          adding={addingAutomation}
          closeAdd={() => setAddingAutomation(false)}
        />
      )}
      {section === "assets" && (
        <AssetsScreen
          createFromAsset={(asset) =>
            setEditor({
              post: {
                id: "",
                clientId: asset.clientId,
                title: "",
                caption: "",
                platform: "Instagram",
                date: "",
                time: "09:00",
                status: "Draft",
                assetId: asset.id,
                notes: [],
              },
            })
          }
        />
      )}
      {section === "reports" && <ReportsScreen />}
      {section === "settings" && <SettingsScreen />}
      {editor && (
        <PostEditor
          key={editor.post?.id || "new"}
          post={editor.post?.id ? editor.post : undefined}
          initialAsset={
            editor.post?.id === "" ? editor.post.assetId : undefined
          }
          initialClient={
            editor.post?.id === "" ? editor.post.clientId : undefined
          }
          defaultDate={editor.date}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
