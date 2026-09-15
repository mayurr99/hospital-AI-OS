import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = process.env.SHOTS ?? "/tmp/claude-0/-home-claude/091039f1-9d6b-5709-8362-84f36ed5d824/scratchpad/shots2";
fs.mkdirSync(OUT, { recursive: true });

const results = [];
let failed = 0;

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failed++;
  console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗"} ${name}\x1b[0m${detail && !ok ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("favicon")) errors.push(m.text().slice(0, 200));
  });
  return { ctx, page, errors };
}

async function clickButton(page, name, exact = true) {
  const btn = page.getByRole("button", { name, exact });
  await btn.first().scrollIntoViewIfNeeded();
  await btn.first().click();
}

async function login(page, email, password = "demo1234") {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.waitForFunction(() => {
    const b = document.querySelector('button[type="submit"]');
    return b && !b.disabled;
  }, { timeout: 10000 });
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|portal|onboarding)/, { timeout: 20000 });
}

/* ---------------- 1. public pages ---------------- */
console.log("\n\x1b[1mPublic pages\x1b[0m");
{
  const { ctx, page, errors } = await newPage();
  for (const [path, needle] of [["/", "AI patient engagement"], ["/signup", "hospital workspace"], ["/login", "Sign in"]]) {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    const text = await page.evaluate(() => document.body.innerText);
    await page.screenshot({ path: `${OUT}/public${path.replace(/\//g, "_")}.png` });
    record(`${path} renders`, text.includes(needle) && errors.length === 0, errors[0] ?? "missing copy");
  }
  await ctx.close();
}

/* ---------------- 2. signup → onboarding → dashboard ---------------- */
console.log("\n\x1b[1mSignup → setup wizard → ready dashboard\x1b[0m");
const uniq = Date.now().toString(36);
const newEmail = `ui+${uniq}@bluebell.test`;
{
  const { ctx, page, errors } = await newPage();
  await page.goto(`${BASE}/signup`, { waitUntil: "networkidle" });
  await page.fill('input[placeholder*="Sunrise"]', `Bluebell Hospital ${uniq}`);
  await page.fill('input[placeholder*="Dr. / Mr."]', "Dr. Neha Kulkarni");
  await page.fill('input[placeholder="Pune"]', "Pune");
  await page.fill('input[type="email"]', newEmail);
  await page.fill('input[type="password"]', "supersecret123");
  await page.check('input[type="checkbox"]');
  await page.click('button[type="submit"]');
  await page.waitForURL(/onboarding/, { timeout: 25000 });
  record("signup lands on the setup wizard", page.url().includes("/onboarding"));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/onboarding_0_goal.png` });

  const stepIndex = async () => {
    const t = await page.evaluate(() => document.body.innerText);
    const m = t.match(/Step (\d+) of 9/);
    return m ? Number(m[1]) - 1 : -1;
  };
  const advance = async (targetIdx, fill) => {
    for (let guard = 0; guard < 12; guard++) {
      const idx = await stepIndex();
      if (idx >= targetIdx) return;
      if (fill) await fill(idx);
      await clickButton(page, "Continue");
      await page.waitForTimeout(700);
    }
  };

  // 0 goal
  await page.click("text=We want the whole hospital in one place");
  await page.waitForTimeout(300);

  await advance(1);
  record("step 1 — hospital profile", (await page.evaluate(() => document.body.innerText)).includes("Your hospital"));
  await page.fill('input[placeholder="Maharashtra"]', "Maharashtra");
  await page.fill('input[placeholder="80"]', "70");

  await advance(2);
  for (const dept of ["Cardiology", "General Medicine", "Paediatrics"]) {
    await page.click(`button:has-text("${dept}")`);
    await page.waitForTimeout(150);
  }
  await page.screenshot({ path: `${OUT}/onboarding_2_departments.png` });
  const deptCount = await page.evaluate(() => document.body.innerText.match(/(\d+) selected/)?.[1]);
  record("departments selectable", deptCount === "3", `got ${deptCount}`);

  await advance(3);
  await clickButton(page, "Add a doctor");
  await page.waitForTimeout(400);
  await page.fill('input[placeholder="Dr. name"]', "Dr. Neha Kulkarni");

  await advance(5);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/onboarding_5_features.png` });
  const featureText = await page.evaluate(() => document.body.innerText);
  record("feature unlock screen lists modules", /of \d+ modules selected/.test(featureText), featureText.slice(0, 90));

  await advance(6);
  await page.click("text=On our own server");
  await page.waitForTimeout(300);

  await advance(7);
  await page.click("text=Built-in simulator");
  await page.fill('input[placeholder*="4000 1099"]', "+912055551234");
  await page.screenshot({ path: `${OUT}/onboarding_7_voice.png` });

  await advance(8);
  await page.waitForTimeout(600);
  const review = await page.evaluate(() => document.body.innerText);
  record("review shows the chosen main line", review.includes("+912055551234"), review.slice(0, 90));
  await page.screenshot({ path: `${OUT}/onboarding_8_review.png` });
  await clickButton(page, "Create my workspace");
  await page.waitForURL(/dashboard/, { timeout: 40000 });
  await page.waitForTimeout(2000);
  const dash = await page.evaluate(() => document.body.innerText);
  await page.screenshot({ path: `${OUT}/new_tenant_dashboard.png` });
  record("lands on a ready dashboard", dash.includes("Dashboard"));
  record("trial banner is shown", /day[s]? left in trial/.test(dash), dash.slice(0, 80));
  record("no console errors through the whole flow", errors.length === 0, errors[0] ?? "");
  await ctx.close();
}

/* ---------------- 3. every screen for the demo admin ---------------- */
console.log("\n\x1b[1mEvery screen (demo hospital admin)\x1b[0m");
const ADMIN_ROUTES = [
  "/dashboard", "/analytics", "/live", "/receptionist", "/campaigns", "/calls", "/recordings",
  "/doctor-crm", "/care-queue", "/escalations", "/patients", "/appointments",
  "/ipd", "/ot", "/labs", "/pharmacy", "/emergency",
  "/messages", "/billing", "/data", "/exports",
  "/admin/users", "/admin/agents", "/admin/protocols", "/admin/org", "/admin/telephony",
  "/admin/integrations", "/admin/audit",
  "/settings/voice", "/settings/storage", "/settings/escalation", "/settings/plan",
];
{
  const { ctx, page, errors } = await newPage();
  await login(page, "sunita.kale@democare.in");
  for (const route of ADMIN_ROUTES) {
    errors.length = 0;
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    const text = await page.evaluate(() => document.body.innerText);
    const denied = text.includes("do not have permission") || text.includes("not unlocked");
    const blank = text.replace(/\s/g, "").length < 200;
    await page.screenshot({ path: `${OUT}/admin${route.replace(/\//g, "_")}.png` });
    record(`${route}`, !denied && !blank && errors.length === 0, denied ? "denied" : blank ? "blank" : errors[0]);
  }
  await ctx.close();
}

/* ---------------- 4. role-scoped views ---------------- */
console.log("\n\x1b[1mRole-scoped access\x1b[0m");
{
  const cases = [
    ["a.deshmukh@democare.in", "/doctor-crm", true, "doctor sees the review queue"],
    ["a.deshmukh@democare.in", "/admin/users", false, "doctor blocked from user management"],
    ["g.more@democare.in", "/appointments", true, "receptionist sees appointments"],
    ["g.more@democare.in", "/doctor-crm", false, "receptionist blocked from the doctor queue"],
    ["r.tambe@democare.in", "/care-queue", true, "nurse sees the care queue"],
    ["f.khan@democare.in", "/billing", true, "billing sees invoices"],
    ["f.khan@democare.in", "/admissions", false, "billing blocked from the ward board"],
    ["rajesh.patil@example.com", "/portal", true, "patient sees their portal"],
    ["mayur@hospitalai.os", "/platform", true, "platform admin sees the tenant console"],
  ];
  for (const [email, route, shouldSee, label] of cases) {
    const { ctx, page } = await newPage();
    await login(page, email);
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const text = await page.evaluate(() => document.body.innerText);
    const denied = text.includes("do not have permission") || text.includes("not unlocked") || page.url().includes("/login");
    record(label, shouldSee ? !denied : denied, `denied=${denied}`);
    if (shouldSee) await page.screenshot({ path: `${OUT}/role_${email.split("@")[0]}${route.replace(/\//g, "_")}.png` });
    await ctx.close();
  }
}

/* ---------------- 5. live call with critical forwarding ---------------- */
console.log("\n\x1b[1mLive call → red flag → forwarded to the main line\x1b[0m");
{
  const { ctx, page, errors } = await newPage();
  await login(page, "r.tambe@democare.in");
  await page.goto(`${BASE}/live`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  const opts = await page.$$eval("select option", (os) => os.map((o) => o.textContent ?? ""));
  const red = opts.find((o) => o.includes("(red)"));
  if (red) await page.selectOption("select", { label: red });
  await page.waitForTimeout(300);

  await clickButton(page, "Start AI call");
  await page.waitForTimeout(34000);
  await page.screenshot({ path: `${OUT}/live_forwarding.png` });
  const mid = await page.evaluate(() => document.body.innerText);
  record("transcript streams", /नमस्कार|नमस्ते|Hello/.test(mid));
  record("red flag detected mid-call", mid.includes("RED"));
  record("tool calls logged", mid.includes("identity.verify"));
  record("call forwarded to the main line", /Forwarded to the main line|escalation opened/i.test(mid), mid.slice(0, 120));

  await page.waitForTimeout(32000);
  const end = await page.evaluate(() => document.body.innerText);
  record("post-call structured summary shown", end.includes("Post-call structured summary"));
  const saveBtn = await page.$("text=Save call & summary");
  if (saveBtn) {
    await saveBtn.click();
    await page.waitForTimeout(2500);
  }
  record("call saved without errors", errors.length === 0, errors[0] ?? "");

  await page.goto(`${BASE}/recordings`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const recText = await page.evaluate(() => document.body.innerText);
  await page.screenshot({ path: `${OUT}/recordings_after_call.png` });
  const hasRecording = !recText.includes("No recordings yet");
  const storageShown = /Local volume|S3 bucket/.test(recText);
  record("recordings library reflects the configured storage", storageShown, recText.slice(0, 80));
  record("recording captured (or correctly skipped for consent)", hasRecording || recText.includes("recording consent"), "");

  await page.goto(`${BASE}/escalations`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const escText = await page.evaluate(() => document.body.innerText);
  record("escalation visible in the queue", escText.includes("RED") || escText.includes("Open"));
  await ctx.close();
}

/* ---------------- 6. settings round-trips in the UI ---------------- */
console.log("\n\x1b[1mSettings round-trips\x1b[0m");
{
  const { ctx, page, errors } = await newPage();
  await login(page, "sunita.kale@democare.in");

  await page.goto(`${BASE}/settings/storage`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await clickButton(page, "Test connection");
  await page.waitForTimeout(2500);
  const stText = await page.evaluate(() => document.body.innerText);
  await page.screenshot({ path: `${OUT}/storage_verified.png` });
  record("storage test reports verified", stText.includes("Storage verified"), stText.slice(0, 120));

  await page.getByRole("button", { name: "S3-compatible bucket" }).first().click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Cloudflare R2", exact: true }).click();
  await page.waitForTimeout(300);
  const endpointVal = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll("input")];
    return inputs.map((i) => i.value).find((v) => v.includes("cloudflarestorage")) ?? "";
  });
  record("S3 preset fills the endpoint", endpointVal.includes("r2.cloudflarestorage.com"), endpointVal);
  await page.getByRole("button", { name: "Local volume" }).first().click();
  await clickButton(page, "Save settings");
  await page.waitForTimeout(1200);

  await page.goto(`${BASE}/settings/voice`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await clickButton(page, "Preview the voice");
  await page.waitForTimeout(3500);
  const vText = await page.evaluate(() => document.body.innerText);
  await page.screenshot({ path: `${OUT}/voice_settings.png` });
  record("voice preview runs", !vText.includes("Could not generate"), "");

  await page.goto(`${BASE}/settings/escalation`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.fill('input[placeholder*="4000 1099"]', "+912040001111");
  await clickButton(page, "Save routing");
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const eVal = await page.inputValue('input[placeholder*="4000 1099"]');
  await page.screenshot({ path: `${OUT}/escalation_settings.png` });
  record("escalation main line persists across a reload", eVal === "+912040001111", eVal);

  await page.goto(`${BASE}/settings/plan`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const pText = await page.evaluate(() => document.body.innerText);
  await page.screenshot({ path: `${OUT}/plan.png` });
  record("plan page shows usage and modules", pText.includes("Voice minutes") && pText.includes("Modules"));
  record("no console errors in settings", errors.length === 0, errors[0] ?? "");
  await ctx.close();
}

/* ---------------- 7. UI CRUD ---------------- */
console.log("\n\x1b[1mUI CRUD flows\x1b[0m");
{
  const { ctx, page, errors } = await newPage();
  await login(page, "sunita.kale@democare.in");

  // invite a user through the UI, then suspend and remove
  await page.goto(`${BASE}/admin/users`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const before = await page.evaluate(() => document.querySelectorAll("tbody tr").length);
  await clickButton(page, "Invite user");
  await page.waitForTimeout(400);
  await page.fill('input[placeholder*="Priya"]', `UI Test User ${uniq}`);
  await page.fill('input[placeholder="name@hospital.in"]', `uitest+${uniq}@democare.in`);
  await clickButton(page, "Send invite");
  await page.waitForTimeout(1800);
  const after = await page.evaluate(() => document.querySelectorAll("tbody tr").length);
  await page.screenshot({ path: `${OUT}/users_after_invite.png` });
  record("user invited through the UI", after === before + 1, `${before} → ${after}`);

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const persisted = await page.evaluate(() => document.body.innerText);
  record("invited user persists after reload", persisted.includes("UI Test User"));

  // appointment booking
  await page.goto(`${BASE}/appointments`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await clickButton(page, "New appointment");
  await page.waitForTimeout(500);
  const dlg = page.locator("div.max-w-4xl");
  await dlg.locator("button", { hasText: "DC1" }).first().click();
  await clickButton(page, "Continue");
  await page.waitForTimeout(500);
  await dlg.locator("button", { hasText: "doctor(s) available" }).first().click();
  await clickButton(page, "Continue");
  await page.waitForTimeout(500);
  await dlg.locator("button", { hasText: "MBBS" }).first().click();
  await page.waitForTimeout(500);
  await dlg.locator("button", { hasText: /\d{2}:\d{2}/ }).first().click();
  await page.click("text=Continue");
  await page.waitForTimeout(700);
  const hold = await page.evaluate(() => document.body.innerText);
  record("slot lock shown before the write", hold.includes("Temporary slot lock active"));
  await clickButton(page, "Confirm booking");
  await page.waitForTimeout(2200);
  const done = await page.evaluate(() => document.body.innerText);
  await page.screenshot({ path: `${OUT}/appointment_booked.png` });
  record("appointment confirmed with an ID", done.includes("Appointment confirmed") && /DC-\d{5}/.test(done));

  // patient consent toggle persists
  await page.goto(`${BASE}/patients`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.locator("tbody tr a").first().click();
  await page.waitForTimeout(1400);
  await page.click("text=Consent & privacy");
  await page.waitForTimeout(600);
  const toggles = page.locator('button[aria-label="WhatsApp / SMS messaging"]');
  const stateBefore = await toggles.first().getAttribute("aria-pressed");
  await toggles.first().click();
  await page.waitForTimeout(1500);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.click("text=Consent & privacy");
  await page.waitForTimeout(600);
  const stateAfter = await page.locator('button[aria-label="WhatsApp / SMS messaging"]').first().getAttribute("aria-pressed");
  await page.screenshot({ path: `${OUT}/patient_consent.png` });
  record("consent change persists across a reload", stateBefore !== stateAfter, `${stateBefore} → ${stateAfter}`);

  // export through the UI
  await page.goto(`${BASE}/exports`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.locator("button", { hasText: "Generate" }).first().click();
  await page.waitForTimeout(600);
  await clickButton(page, "Generate & download");
  await page.waitForTimeout(2500);
  const exText = await page.evaluate(() => document.body.innerText);
  await page.screenshot({ path: `${OUT}/exports.png` });
  record("export appears in the history", /valid until|used /.test(exText), exText.slice(0, 120));

  record("no console errors during CRUD", errors.length === 0, errors[0] ?? "");
  await ctx.close();
}

/* ---------------- 8. mobile ---------------- */
console.log("\n\x1b[1mMobile layout\x1b[0m");
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await login(page, "sunita.kale@democare.in");
  for (const route of ["/dashboard", "/patients", "/live"]) {
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    await page.screenshot({ path: `${OUT}/mobile${route.replace(/\//g, "_")}.png` });
    record(`${route} has no horizontal overflow at 390px`, !overflow);
  }
  await ctx.close();
}

await browser.close();

console.log(`\n\x1b[1m${results.length - failed} passed, ${failed} failed\x1b[0m`);
if (failed) {
  console.log("\nFailures:");
  for (const r of results.filter((x) => !x.ok)) console.log(`  • ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
process.exit(failed ? 1 : 0);
