/** Capture presentation-quality screenshots for the pitch deck. */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://localhost:3100";
const OUT = "/home/claude/deck-assets";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

async function session(email, password = "demo1234", width = 1600, height = 1000) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.waitForFunction(() => {
    const b = document.querySelector('button[type="submit"]');
    return b && !b.disabled;
  });
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|portal)/, { timeout: 25000 });
  await page.waitForTimeout(2000);
  return { ctx, page };
}

async function shot(page, route, name, wait = 2200) {
  await page.goto(BASE + route, { waitUntil: "networkidle" });
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("captured", name);
}

/* --- admin views --- */
{
  const { ctx, page } = await session("sunita.kale@democare.in");
  await shot(page, "/dashboard", "dashboard");
  await shot(page, "/analytics", "analytics", 3000);
  await shot(page, "/escalations", "escalations");
  await shot(page, "/admin/protocols", "protocols");
  await shot(page, "/admin/agents", "agents");
  await shot(page, "/settings/voice", "voice-settings");
  await shot(page, "/settings/storage", "storage-settings");
  await shot(page, "/settings/escalation", "escalation-settings");
  await shot(page, "/recordings", "recordings");
  await shot(page, "/exports", "exports");
  await shot(page, "/admin/audit", "audit");
  await shot(page, "/admin/users", "users");
  await ctx.close();
}

/* --- doctor view --- */
{
  const { ctx, page } = await session("a.deshmukh@democare.in");
  await shot(page, "/doctor-crm", "doctor-queue");
  await ctx.close();
}

/* --- receptionist: restricted view proving least privilege --- */
{
  const { ctx, page } = await session("g.more@democare.in");
  await shot(page, "/patients", "receptionist-restricted");
  await ctx.close();
}

/* --- live call, captured mid-escalation --- */
{
  const { ctx, page } = await session("r.tambe@democare.in");
  await page.goto(`${BASE}/live`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const opts = await page.$$eval("select option", (os) => os.map((o) => o.textContent ?? ""));
  const red = opts.find((o) => o.includes("(red)"));
  if (red) await page.selectOption("select", { label: red });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/live-before.png` });
  const btn = page.getByRole("button", { name: "Start AI call", exact: true });
  await btn.click();
  await page.waitForTimeout(30000);
  await page.screenshot({ path: `${OUT}/live-escalating.png` });
  console.log("captured live-escalating");
  await page.waitForTimeout(22000);
  await page.screenshot({ path: `${OUT}/live-summary.png` });
  console.log("captured live-summary");
  await ctx.close();
}

/* --- signup + onboarding --- */
{
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/landing.png` });

  const u = Date.now().toString(36);
  await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.fill('input[placeholder*="Sunrise"]', "Sahyadri Multispeciality Hospital");
  await page.fill('input[placeholder*="Dr. / Mr."]', "Dr. Anagha Kulkarni");
  await page.fill('input[placeholder="Pune"]', "Pune");
  await page.fill('input[type="email"]', `deck+${u}@sahyadri.test`);
  await page.fill('input[type="password"]', "supersecret123");
  await page.check('input[type="checkbox"]');
  await page.screenshot({ path: `${OUT}/signup.png` });
  await page.click('button[type="submit"]');
  await page.waitForURL(/onboarding/, { timeout: 25000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/onboarding-goal.png` });

  const stepIdx = async () => {
    const t = await page.evaluate(() => document.body.innerText);
    const m = t.match(/Step (\d+) of 9/);
    return m ? Number(m[1]) - 1 : -1;
  };
  const cont = async () => {
    const b = page.getByRole("button", { name: "Continue", exact: true });
    await b.first().scrollIntoViewIfNeeded();
    await b.first().click();
    await page.waitForTimeout(700);
  };
  const advance = async (target) => {
    for (let i = 0; i < 12 && (await stepIdx()) < target; i++) await cont();
  };

  await page.getByRole("button", { name: /whole hospital in one place/ }).first().click();
  await page.waitForTimeout(300);
  await advance(2);
  for (const d of ["Cardiology", "General Medicine", "Orthopaedics", "Obstetrics & Gynaecology", "Paediatrics"]) {
    await page.getByRole("button", { name: d, exact: true }).first().click();
    await page.waitForTimeout(120);
  }
  await page.screenshot({ path: `${OUT}/onboarding-departments.png` });
  await advance(5);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/onboarding-features.png` });
  await advance(6);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/onboarding-storage.png` });
  await advance(7);
  await page.getByRole("button", { name: /Built-in simulator/ }).first().click();
  await page.fill('input[placeholder*="4000 1099"]', "+91 20 6800 4500");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/onboarding-voice.png` });
  await advance(8);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/onboarding-review.png` });
  console.log("captured onboarding");
  await ctx.close();
}

/* --- platform console --- */
{
  const { ctx, page } = await session("mayur@hospitalai.os");
  await shot(page, "/platform", "platform");
  await ctx.close();
}

await browser.close();
console.log("done");
