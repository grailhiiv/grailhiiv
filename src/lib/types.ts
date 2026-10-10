export const sections = [
  "overview",
  "calendar",
  "approvals",
  "leads",
  "automations",
  "assets",
  "reports",
  "settings",
] as const;
export type Section = (typeof sections)[number];
export type PostStatus =
  | "Draft"
  | "Awaiting approval"
  | "Changes requested"
  | "Scheduled"
  | "Published";
export type LeadStage = "New" | "Qualified" | "Contacted" | "Won";
export type Client = {
  id: string;
  name: string;
  initials: string;
  color: string;
  website: string;
  contact: string;
  email: string;
  timezone: string;
  voice: string;
  audience: string;
  approvalRequired: boolean;
  logo?: string;
  description?: string;
};
export type Post = {
  id: string;
  clientId: string;
  title: string;
  caption: string;
  platform: string;
  date: string;
  time: string;
  status: PostStatus;
  assetId: string;
  notes: { text: string; date: string }[];
  metrics?: { reach: number; engagements: number; leads: number };
};
export type Lead = {
  id: string;
  clientId: string;
  name: string;
  email: string;
  source: string;
  stage: LeadStage;
  interest: string;
  task: string;
  due: string;
  notes: { text: string; date: string }[];
};
export type Automation = {
  id: string;
  name: string;
  clientId: string;
  trigger: string;
  enabled: boolean;
  runs: {
    id: string;
    date: string;
    status: "Success" | "Failed";
    detail: string;
  }[];
};
export type Asset = {
  id: string;
  clientId: string;
  name: string;
  type: string;
  size: number;
  url: string;
  status: "Approved" | "Draft";
  tags: string[];
  uploaded: boolean;
  storagePath?: string;
  variants?: Partial<
    Record<"overview" | "calendar" | "approval" | "detail", string>
  >;
  dimensions?: string;
  displayFormat?: string;
};
export type Activity = {
  id: string;
  text: string;
  clientId: string;
  date: string;
};
export type Workspace = {
  version: 1;
  clients: Client[];
  posts: Post[];
  leads: Lead[];
  automations: Automation[];
  assets: Asset[];
  activities: Activity[];
  preferences: { name: string; notifications: boolean };
};
