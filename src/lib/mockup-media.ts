import type { Asset, Workspace } from "./types";
const url = (name: string) => `/media/mockup/${name}.png`;
const specs: [string, string, string, string, number, Asset["status"]][] = [
  ["skincare", "bloom", "skincare-collection.jpg", "skincare", 2.4, "Approved"],
  ["coffee", "coastal", "coastal-coffee.jpg", "coffee", 1.8, "Approved"],
  ["clinic", "northside", "dental-office.jpg", "clinic", 2.1, "Approved"],
  ["beach", "coastal", "beach-lifestyle.jpg", "beach", 3.2, "Approved"],
  [
    "dental-logo",
    "northside",
    "northside-dental-logo.png",
    "dental-logo",
    0.32,
    "Approved",
  ],
  [
    "morning-routine",
    "bloom",
    "morning-routine.mp4",
    "morning-routine",
    12.4,
    "Draft",
  ],
  ["wellness", "bloom", "wellness-hero.jpg", "wellness", 1.9, "Approved"],
  ["brunch", "coastal", "brunch-flatlay.jpg", "brunch", 2.7, "Approved"],
  ["coast", "coastal", "coastal-cliffs.jpg", "coast", 2.3, "Draft"],
  [
    "patient",
    "northside",
    "healthy-smiles.jpg",
    "approval-patient",
    1.6,
    "Approved",
  ],
  [
    "yoga",
    "bloom",
    "morning-mindfulness.jpg",
    "approval-yoga",
    1.8,
    "Approved",
  ],
  ["tools", "northside", "dental-care.jpg", "approval-tools", 1.3, "Approved"],
  [
    "smoothie",
    "bloom",
    "nourish-your-routine.jpg",
    "approval-smoothie",
    1.5,
    "Approved",
  ],
  ["palm", "coastal", "sunset-vibes.jpg", "idea-palm", 1.8, "Draft"],
  ["routine", "bloom", "morning-routine.jpg", "idea-routine", 1.3, "Draft"],
  ["brush", "northside", "dental-checklist.jpg", "idea-brush", 1.1, "Draft"],
  [
    "report-cafe",
    "coastal",
    "coastal-cafe.jpg",
    "report-cafe",
    1.8,
    "Approved",
  ],
  [
    "report-villas",
    "coastal",
    "seaside-villas.jpg",
    "report-villas",
    1.8,
    "Approved",
  ],
  [
    "report-interior",
    "coastal",
    "coastal-interior.jpg",
    "report-interior",
    1.8,
    "Approved",
  ],
  [
    "report-resort",
    "coastal",
    "blue-bay-resort.jpg",
    "report-resort",
    1.8,
    "Approved",
  ],
];
export const mockupAssets: Asset[] = specs.map(
  ([id, clientId, name, image, size, status]) => ({
    id,
    clientId,
    name,
    url: url(image),
    type: "image/png",
    displayFormat: name.endsWith(".mp4")
      ? "MP4 still"
      : name.endsWith(".jpg")
        ? "JPG"
        : "PNG",
    size: Math.round(size * 1024 * 1024),
    status,
    tags:
      id === "coffee"
        ? ["Coffee", "Lifestyle", "October campaign"]
        : id === "dental-logo"
          ? ["Brand kit"]
          : ["Campaign"],
    uploaded: false,
    dimensions: id === "coffee" ? "2400 × 1600 (sample)" : undefined,
  }),
);
const variants: Record<string, Asset["variants"]> = {
  coffee: {
    overview: url("overview-coffee"),
    calendar: url("calendar-coffee"),
    approval: url("approval-coffee"),
    detail: url("coffee-detail"),
  },
  skincare: {
    overview: url("overview-skincare"),
    calendar: url("calendar-skincare"),
  },
  clinic: { overview: url("overview-clinic"), calendar: url("calendar-team") },
  coast: { approval: url("approval-coast"), calendar: url("calendar-coast") },
  patient: { calendar: url("calendar-smile") },
  wellness: { calendar: url("calendar-wellness") },
  tools: { calendar: url("calendar-brush") },
  brunch: { calendar: url("calendar-latte") },
};
for (const asset of mockupAssets) asset.variants = variants[asset.id];
export function applyMockupMedia(data: Workspace): Workspace {
  // Preserve browser records, status changes, notes, uploads and user-created clients.
  const known = new Map(mockupAssets.map((a) => [a.id, a]));
  // An explicitly cleared logo remains cleared after reloading.
  return {
    ...data,
    assets: [
      ...data.assets.filter((a) => a.uploaded || !known.has(a.id)),
      ...mockupAssets.map((a) => {
        const previous = data.assets.find((old) => old.id === a.id);
        return previous ? { ...previous, ...a, status: previous.status } : a;
      }),
    ],
    clients: data.clients.map((c) => ({
      ...c,
      logo:
        c.logo !== undefined
          ? c.logo
          : ["coastal", "northside", "bloom"].includes(c.id)
            ? url(`${c.id}-logo`)
            : undefined,
      description:
        c.description ||
        (
          {
            coastal: "Café & lifestyle brand",
            northside: "Dental clinic",
            bloom: "Wellness & pilates studio",
          } as Record<string, string>
        )[c.id],
    })),
  };
}
