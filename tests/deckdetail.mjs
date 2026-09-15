/** Capture element-level detail shots for the pitch deck. */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://localhost:3100";
const OUT = "/home/claude/deck-assets";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 3 });
const page = await ctx.newPage();

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
await page.fill('input[type="email"]', "r.tambe@democare.in");
await page.fill('input[type="password"]', "demo1234");
await page.waitForFunction(() => {
  const b = document.querySelector('button[type="submit"]');
  return b && !b.disabled;
});
await page.click('button[type="submit"]');
await page.waitForURL(/\/dashboard/, { timeout: 25000 });
await page.waitForTimeout(1500);

await page.goto(`${BASE}/live`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const opts = await page.$$eval("select option", (os) => os.map((o) => o.textContent ?? ""));
const red = opts.find((o) => o.includes("(red)"));
if (red) await page.selectOption("select", { label: red });
await page.waitForTimeout(400);

await page.getByRole("button", { name: "Start AI call", exact: true }).click();
await page.waitForTimeout(31000);

// Whole-page capture, then crop precise card rectangles from it.
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
const dpr = 3;
const rects = await page.evaluate(() => {
  const out = {};
  for (const h3 of Array.from(document.querySelectorAll("h3"))) {
    let el = h3;
    // walk up to the nearest card: a rounded, bordered block
    for (let i = 0; i < 8 && el.parentElement; i++) {
      el = el.parentElement;
      const cs = getComputedStyle(el);
      if (parseFloat(cs.borderTopLeftRadius) >= 10 && parseFloat(cs.borderTopWidth) > 0) break;
    }
    const r = el.getBoundingClientRect();
    out[h3.textContent.trim()] = {
      x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height,
    };
  }
  return out;
});
fs.writeFileSync(`${OUT}/rects.json`, JSON.stringify({ dpr, rects }, null, 2));
console.log(JSON.stringify(rects, null, 1));

await ctx.close();
await browser.close();
