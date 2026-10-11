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
const headings: Record<Section, string> = {
  overview: "Overview",
  calendar: "Content Calendar",
  approvals: "Approvals",
  leads: "Leads & CRM",
  automations: "Automations",
  assets: "Asset Library",
  reports: "Reports",
  settings: "Settings",
};
export function WorkspaceScreen({ section }: { section: Section }) {
  const { session } = useWorkspace();
  const reviewer = session?.role === "client_reviewer";
  const [editor, setEditor] = useState<{ post?: Post; date?: string } | null>(
    null,
  );
  const [addingLead, setAddingLead] = useState(false);
  const [addingAutomation, setAddingAutomation] = useState(false);
  const create = (date = "") => {
    if (!reviewer) setEditor({ date });
  };
  const edit = (post: Post) => {
    if (!reviewer) setEditor({ post });
  };
  if (reviewer && !["overview", "approvals", "assets"].includes(section))
    return (
      <div className="page">
        <h1>Client Access</h1>
        <p>Your role provides content review and asset access.</p>
      </div>
    );
  return (
    <div className={"page page-" + section}>
      <div className="page-heading">
        <div>
          <h1>{headings[section]}</h1>
        </div>
        <div className="heading-actions">
          {!reviewer && (section === "overview" || section === "calendar") && (
            <button className="button primary" onClick={() => create()}>
              <Plus size={20} />
              Create Content
            </button>
          )}
          {section === "leads" && (
            <button
              className="button primary"
              onClick={() => setAddingLead(true)}
            >
              <Plus size={17} />
              Add Lead
            </button>
          )}
          {section === "automations" && (
            <button
              className="button primary"
              onClick={() => setAddingAutomation(true)}
            >
              <Plus size={17} />
              New Automation
            </button>
          )}
          {section === "assets" && !reviewer && (
            <button className="button primary" onClick={() => document.getElementById("asset-upload")?.click()}>
              <Upload size={20} />
              Upload Assets
            </button>
          )}
          {section === "reports" && (
            <button
              className="button primary"
              onClick={() => document.getElementById("export-report")?.click()}
            >
              <ArrowDownToLine size={17} />
              Export Report
            </button>
          )}
        </div>
      </div>
      {section === "overview" &&
        (reviewer ? (
          <Approvals edit={edit} />
        ) : (
          <Overview create={create} edit={edit} />
        ))}
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
