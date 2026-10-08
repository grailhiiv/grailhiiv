import { test, expect } from "@playwright/test";

const routes = [
  "/",
  "/calendar",
  "/approvals",
  "/leads",
  "/automations",
  "/assets",
  "/reports",
  "/settings",
];
test("short landscape navigation and narrow-phone forms remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 820, height: 360 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("Settings");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/calendar");
  await page
    .getByRole("button", { name: "Create content", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(
    await dialog
      .getByLabel("Post title")
      .evaluate((el) => getComputedStyle(el).fontSize),
  ).toBe("16px");
  await dialog.getByLabel("Post title").fill("Readable mobile draft");
  await dialog.getByRole("button", { name: "Save draft" }).click();
  await expect(dialog).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
for (const width of [
  320, 390, 480, 720, 768, 820, 1024, 1100, 1280, 1536, 1920,
]) {
  test(`all dashboards stay readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of routes) {
      await page.goto(route);
      await expect(page.locator("h1")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.evaluate(() => {
        const heading = document.querySelector("h1")!.getBoundingClientRect();
        const header = document
          .querySelector(".topbar")!
          .getBoundingClientRect();
        const small = [...document.querySelectorAll("main *")]
          .filter(
            (el) =>
              el.getClientRects().length &&
              [...el.childNodes].some(
                (n) => n.nodeType === 3 && n.textContent?.trim(),
              ) &&
              parseFloat(getComputedStyle(el).fontSize) < 14,
          )
          .map((el) => `${el.tagName}.${el.className}`);
        const collisions = [
          ...document.querySelectorAll(".metric-card"),
        ].filter((card) => {
          const label = card
            .querySelector(".metric-top > span:first-child")
            ?.getBoundingClientRect();
          const value = card
            .querySelector(":scope > strong")
            ?.getBoundingClientRect();
          return label && value && label.bottom > value.top + 1;
        }).length;
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          headerOverlap: header.bottom > heading.top + 1,
          small,
          collisions,
        };
      });
      expect(layout, route).toEqual({
        overflow: false,
        headerOverlap: false,
        small: [],
        collisions: 0,
      });
    }
    if (width <= 1024) {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(
        page.getByRole("navigation", { name: "Main navigation" }),
      ).toBeVisible();
      await page.getByRole("link", { name: "Overview", exact: true }).click();
      await expect(
        page.getByRole("navigation", { name: "Main navigation" }),
      ).toBeHidden();
    }
  });
}
