export type AutomationRun = {
  id: string;
  automation_id: string;
  status: "Queued" | "Running" | "Success" | "Failed" | "Unknown";
  detail: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  execution_id: string | null;
};
export type AutomationConnection = {
  configured: boolean;
  reachable: boolean;
  workflows: { key: string; label: string }[];
  bindings: { automation_id: string; workflow_key: string }[];
  runs: AutomationRun[];
};
