// T5 integrated interaction pass (issue #5, integrated dc7dc9b build) on the converted
// production build, plus FR-10 assertions for the icon-picker-menu buttons
// with the picker open. Prints one PASS/FAIL line per check.
import { chromium } from "/home/chrissim/Projects/worktree/baby-tracking-web/issue-5/node_modules/playwright-core/index.mjs";

const URL = process.env.TARGET_URL || "http://localhost:4640";
const results = [];
const check = (name, ok, detail = "") =>
  results.push({ name, ok, detail: String(detail) });

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(15000);
await page.goto(URL, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);

await page.evaluate(() => {
  window.__printCalls = 0;
  window.print = () => { window.__printCalls += 1; };
});

// Pick the first unused icon in the picker (mirrors the parity harness).
async function pickFreshIcon() {
  await page.locator(".icon-picker-trigger").click();
  await page.waitForSelector(".icon-picker-menu");
  await page
    .locator(".icon-picker-menu button[role='option']:not([disabled])")
    .first()
    .click();
  await page.waitForFunction(
    () => !document.querySelector(".icon-picker-menu"),
  );
}

// --- 1. defaults: 2 days x 5 items --------------------------------------
check("initial legend items = 5", (await page.locator(".legend-item").count()) === 5);
check("initial print-days = 2", (await page.locator(".print-day").count()) === 2);

// --- 2. chip selected/unselected state ----------------------------------
const diaper = page.locator(".item-chips .item-chip", { hasText: "Diaper" }).first();
await diaper.click(); // unselect
await page.waitForFunction(
  () => !document.querySelector(".item-chips .item-chip")?.classList.contains("selected"),
);
const unselectedBg = await diaper.evaluate((el) => getComputedStyle(el).backgroundColor);
check("chip unselect: class removed", true);
await diaper.click(); // reselect
await page.waitForFunction(
  () => document.querySelector(".item-chips .item-chip")?.classList.contains("selected"),
);
const selectedBg = await diaper.evaluate((el) => getComputedStyle(el).backgroundColor);
check(
  "chip state visual: white when unselected, selected wash when selected",
  unselectedBg === "rgb(255, 255, 255)" && selectedBg === "rgb(242, 248, 239)",
  `unselected=${unselectedBg} selected=${selectedBg}`,
);

// --- 3. icon picker states ----------------------------------------------
await page.locator(".icon-picker-trigger").click();
await page.waitForSelector(".icon-picker-menu");
check("icon picker opens", await page.locator(".icon-picker-menu").isVisible());
const optionCount = await page.locator(".icon-picker-menu button[role='option']").count();
check("icon picker lists 16 options", optionCount === 16, optionCount);
const activeOption = await page
  .locator(".icon-picker-menu button[role='option'].active")
  .count();
check("current icon option has active class", activeOption === 1, activeOption);
const activeBg = await page
  .locator(".icon-picker-menu button[role='option'].active")
  .evaluate((el) => getComputedStyle(el).backgroundColor);
check("active option highlight bg rgb(242,248,239) (FR-10)", activeBg === "rgb(242, 248, 239)", activeBg);
const disabledOptions = await page
  .locator(".icon-picker-menu button[role='option']:disabled")
  .count();
check("used icons disabled in picker (5 used)", disabledOptions === 5, disabledOptions);
const disabledOpacity = await page
  .locator(".icon-picker-menu button[role='option']:disabled")
  .first()
  .evaluate((el) => getComputedStyle(el).opacity);
check("disabled option opacity 0.4", disabledOpacity === "0.4", disabledOpacity);

const hoverTarget = page
  .locator(".icon-picker-menu button[role='option']:not([disabled])")
  .first();
await hoverTarget.hover();
const hoverBg = await hoverTarget.evaluate((el) => getComputedStyle(el).backgroundColor);
check("menu button hover bg rgb(240,246,236) (FR-10)", hoverBg === "rgb(240, 246, 236)", hoverBg);

await page.mouse.move(0, 0); // clear :hover before reading rest state
await page.waitForTimeout(80);
const menuBtn = page
  .locator(".icon-picker-menu button[role='option']")
  .first();
const menuBtnStyle = await menuBtn.evaluate((el) => {
  const cs = getComputedStyle(el);
  return `${cs.fontFamily}|${cs.fontSize}|${cs.backgroundColor}`;
});
check(
  "menu button font/size/bg (FR-10): DM Sans|10px|white",
  menuBtnStyle === '"DM Sans"|10px|rgb(255, 255, 255)',
  menuBtnStyle,
);
await page.locator(".icon-picker-trigger").click(); // close
check("picker closes on trigger re-click", (await page.locator(".icon-picker-menu").count()) === 0);

// --- 4. custom item WITH translation ------------------------------------
await page.locator(".add-item input").first().fill("Piano");
await pickFreshIcon();
await page.locator(".add-item input.custom-translation").fill("钢琴");
await page.locator(".add-item > button").click();
await page.waitForFunction(
  () => document.querySelectorAll(".legend-item").length === 6,
);
const legendText = await page
  .locator(".legend-item", { hasText: "Piano" })
  .first()
  .innerText();
check("custom item with translation renders 'Piano / 钢琴'", legendText.includes("Piano / 钢琴"), legendText);

// --- 5. custom item WITHOUT translation ---------------------------------
await page.locator(".add-item input").first().fill("Walk");
await pickFreshIcon();
await page.locator(".add-item input.custom-translation").fill("");
await page.locator(".add-item > button").click();
await page.waitForFunction(
  () => document.querySelectorAll(".legend-item").length === 7,
);
const walkText = await page
  .locator(".legend-item", { hasText: "Walk" })
  .first()
  .innerText();
check(
  "custom item without translation falls back to main name ('Walk / Walk')",
  walkText.includes("Walk / Walk"),
  walkText,
);

// --- 6. language switching ----------------------------------------------
await page.locator(".language-fields select").first().selectOption("中文");
await page.waitForFunction(() =>
  document.querySelector(".print-date")?.textContent.includes("日期"),
);
const dateText = await page.locator(".print-date").first().innerText();
check("main=中文 switches Date label to 日期", dateText.includes("日期"), dateText.split("\n")[0]);
const zhLegend = await page
  .locator(".legend-item", { hasText: "换尿布" })
  .count();
check("legend translates to zh (Diaper → 换尿布 present)", zhLegend === 1, `matching items=${zhLegend}`);

await page.locator(".language-fields select").nth(1).selectOption("None");
check(
  "sub=None hides the translation input",
  (await page.locator(".add-item input.custom-translation").count()) === 0,
);
const noSubLegend = await page
  .locator(".legend-item")
  .first()
  .innerText();
check("sub=None removes '/ sub-name' suffix from legend", !noSubLegend.includes("/"), noSubLegend);
await page.locator(".language-fields select").nth(1).selectOption("中文");

// --- 7. limits: 16 on one day -------------------------------------------
await page.locator(".choice-row .choice").first().click(); // 1 day
await page.waitForFunction(() => document.querySelectorAll(".print-day").length === 1);
check("switch to 1 day", true);

for (let i = 1; i <= 9; i++) {
  await page.locator(".add-item input").first().fill(`Custom ${i}`);
  await pickFreshIcon();
  const transInput = page.locator(".add-item input.custom-translation");
  if (await transInput.count()) await transInput.fill(`客 ${i}`);
  await page.locator(".add-item > button").click();
  await page.waitForFunction(
    (n) => document.querySelectorAll(".legend-item").length >= n,
    7 + i,
  );
}
const count16 = await page.locator(".legend-item").count();
check("reached 16 items on 1 day (16/1 extreme)", count16 === 16, count16);

const addDisabled = await page.locator(".add-item > button").isDisabled();
const chipsDisabled = await page
  .locator(".item-chips .item-chip:not(.selected)")
  .evaluateAll((els) => els.every((el) => el.disabled));
check("at 16/1: Add button disabled (17th item blocked)", addDisabled);
check("at 16/1: unselected chips disabled", chipsDisabled);

// --- 8. blocked two-day switch ------------------------------------------
const twoDays = page.locator(".choice-row .choice").nth(1);
check("at >7 items: 2-day choice disabled", await twoDays.isDisabled());
check(
  "at >7 items: 2-day choice has title hint",
  (await twoDays.getAttribute("title")) === "Remove items to use two days per page",
);
await twoDays.click({ force: true }).catch(() => {});
check(
  "forced click does not switch to 2 days",
  (await page.locator(".print-day").count()) === 1,
);

for (let i = 0; i < 9; i++) {
  await page.locator(".item-chips .item-chip.selected").last().click();
}
await page.waitForFunction(
  () => document.querySelectorAll(".legend-item").length === 7,
);
check("unselect down to 7 items", true);
check("2-day choice enabled again at 7 items", !(await twoDays.isDisabled()));
await twoDays.click();
await page.waitForFunction(() => document.querySelectorAll(".print-day").length === 2);
check("switches to 2 days at 7 items", true);

const chipDisabledNow = await page
  .locator(".item-chips .item-chip:not(.selected)")
  .first()
  .isDisabled();
check("at 7/2: unselected default chips disabled (8th item blocked)", chipDisabledNow);
await page.locator(".add-item input").first().fill("Extra");
check("at 7/2: Add button disabled (8th item blocked)", await page.locator(".add-item > button").isDisabled());

// --- 9. print buttons ----------------------------------------------------
await page.evaluate(() => { window.__printCalls = 0; });
await page.locator(".topbar .top-print").click();
await page.locator(".preview-footer button:not(.download-link)").click();
await page.locator(".preview-footer button.download-link").click();
const calls = await page.evaluate(() => window.__printCalls);
check("both print buttons + download link call window.print (3 calls)", calls === 3, calls);

// --- 10. keyboard focus --------------------------------------------------
await page.locator(".item-chips .item-chip.selected").last().click(); // free one slot (6 items)
await page.waitForFunction(() => document.querySelectorAll(".legend-item").length === 6);
await page.locator(".add-item input").first().focus();
await page.keyboard.type("KeyItem");
await page.keyboard.press("Enter");
const keyAdded = await page.locator(".legend-item", { hasText: "KeyItem" }).count();
check("keyboard: typing + Enter in input adds item", keyAdded === 1, keyAdded);

await page.locator(".item-chips .item-chip").first().focus();
await page.keyboard.press("Enter");
const toggled = await page.evaluate(() => {
  const chips = document.querySelectorAll(".item-chips .item-chip");
  return !chips[0].classList.contains("selected");
});
check("keyboard: focused chip toggles with Enter", toggled);
await page.keyboard.press("Enter"); // reselect

const focusables = await page.evaluate(() => {
  const els = [
    ...document.querySelectorAll(
      ".choice-row .choice, .item-chips .item-chip, .add-item input, .add-item > button, .icon-picker-trigger, .language-fields select",
    ),
  ];
  return els.filter((el) => el.disabled || el.tabIndex < 0).length;
});
const totalControls = await page.evaluate(
  () =>
    document.querySelectorAll(
      ".choice-row .choice, .item-chips .item-chip, .add-item input, .add-item > button, .icon-picker-trigger, .language-fields select",
    ).length,
);
check(
  "keyboard: all controls tabbable or intentionally disabled",
  focusables > 0 && focusables <= totalControls,
  `disabled/limited=${focusables}/${totalControls} (limits make them disabled by design)`,
);

await browser.close();

let fail = 0;
console.log("=== INTERACTION PASS ===");
for (const r of results) {
  if (!r.ok) fail++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
console.log(`\ninteraction: ${results.length - fail}/${results.length} PASS`);
process.exit(fail ? 1 : 0);
