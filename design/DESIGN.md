# GrailHiiv design translation

Reference: eight generated desktop mockups in `mockups/`.

- Persistent pale sidebar: roughly 240 px, client selector above eight navigation entries. Active navigation uses muted teal with a slim edge marker.
- White content panels on an almost-white gray canvas; fine gray borders, restrained corner radii, minimal shadows.
- Dark teal primary actions, charcoal headings, subdued secondary text. Status colors carry meaning: amber pending, green scheduled/approved, gray draft, red revisions/failure.
- Reference-matching typography: locally hosted Roboto variable font, 34 px page titles, 20 px panel headings, and 14–16 px interface copy; small calendar labels reproduce the source's denser scale. The image generator supplied raster PNGs, not a font specification: Roboto is a visually matched choice, not a verified identification of the original font.
- Overview: four compact metrics, attention queue and content previews on the left, assistant and activity on the right, pipeline below.
- Calendar: month grid plus unscheduled ideas; status and client visible on every post. List view provides an alternate reading mode.
- Approvals: queue on the left, creative/caption/date/feedback on the right; decision actions at the bottom.
- CRM: four pipeline columns and a contact details panel. Mobile pipeline scrolls within the page.
- Automations: workflow table, enabled states, selected workflow steps and run history. Actual integration status is explicit.
- Assets: folders, three-column media grid, selected-file information. Photos, logo marks and avatars are unchanged pixel crops of the original mockups, stored in `public/media/mockup`. The nine Asset Library examples appear first; additional content/approval/report examples follow. `provenance.json` records every crop and its original source coordinates. A pixel-level test verifies all 50 crops.
- Reports: client/period/platform filters, compact metrics, reach chart, platform comparison and top content.
- Settings: client list and editable brand preferences. Connection pages show their real unconfigured state.

Responsive translation: sidebar becomes a mobile drawer; panels stack; wide calendars/tables scroll inside their container; all dialogs fit the viewport. No full-page mockup is embedded as a substitute for a functioning interface.

## Fidelity pass

The desktop verification size is 1536 × 1024, matching each reference. The sidebar is 256 px, topbar 56 px, and desktop page gutters 24 px; Overview and Approvals reproduce the reference's header arrangement. Calendar cells use a 114 px opening row and 154 px subsequent rows; extra records scroll within a day. Approvals uses a 352 px queue, portrait creative and right-hand caption/notes. Asset Library uses 195 px folders and a 313 px inspector. Settings uses a 291 px client list. Reports adds the reference's four-field filter row, sparklines, lead funnel and stacked right-hand panels.

Generated references disagree on sample counts, dates, avatars and brand marks between pages. Shared application records remain consistent rather than using contradictory hard-coded counters. Disconnected-service labels, sample markers, GrailHiiv branding and editable controls are intentional differences; this is not claimed to be a pixel-perfect reproduction of every raster artifact. Old saved drafts, notes, client edits and uploads are preserved by media migration rather than replaced with fresh seed data.

The original high-resolution photo/video files are not available: extracted images retain the mockup resolution. The sample `morning-routine.mp4` entry is explicitly labeled as a still, not a playable video. Original dimensions and sizes shown in the mockup are sample metadata, not dimensions of the cropped PNG.

## Responsive readability pass

The current UI prioritizes readability over the raster mockups' tiny annotations. The shared scale uses 14 px secondary text, 16 px body/form text, 20 px section headings, and fluid 28–34 px page titles. Topbars are now 64 px and remain in document flow, avoiding title/date collisions. Navigation becomes a drawer at 1024 px and below; metrics switch to two columns at 1400 px and a single column at 480 px. Content and asset cards stack on narrow phones. Controls use a 44 px minimum action height. Wide calendars, CRM boards, tables and the reach chart scroll within their own containers rather than shrinking text or widening the whole page.

Browser regression checks cover every dashboard at eleven widths from 320 to 1920 px, including 720 px and intermediate tablet widths. They check body overflow, header separation, metric-label/value collisions, and a 14 px text floor. Existing functional workflows and exact image crops remain covered by their original tests.
