/**
 * The second-factor screens, driven through a real browser.
 *
 * tests/auth.mjs proves the server refuses a password on its own. This proves a
 * person can actually get past that refusal: that the QR renders, the code box
 * takes a code, the backup codes appear once and the dashboard opens — because
 * an authentication system that is correct and unusable locks a ward out of its
 * own records at three in the morning.
 *
 * Run with the app already serving on BASE (default http://localhost:3100).
 */
import { chromium } from "playwright";
import { freshCode } from "./totp-client.mjs";

const BASE = process.env.BASE ?? "http://localhost:3100";
const CHROME = process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

let passed = 0, failed = 0;
const failures = [];
let group = "";
const section = (n) => { group = n; console.log(`\n\x1b[1m${n}\x1b[0m`); };
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { failed++; failures.push(`${group} → ${name}${detail ? ` (${detail})` : ""}`); console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? ` — ${detail}` : ""}`); }
}
async function part(name, fn) {
  section(name);
  try { await fn(); }
  catch (e) { check("section completed without throwing", false, String(e.message ?? e).split("\n")[0].slice(0, 140)); }
}

const uniq = Date.now().toString(36);
const PASSWORD = "supersecret123";
const email = `ui.admin+${uniq}@authuitest.test`;

/* A real hospital, created through the API — the browser's job here is the
   sign-in screens, not the signup form, which other suites already cover. */
const signup = await fetch(`${BASE}/api/auth/signup`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    hospitalName: `Auth UI Hospital ${uniq}`,
    adminName: "Nandini Joshi",
    email,
    password: PASSWORD,
    acceptedTerms: true,
  }),
});
if (!signup.ok) {
  console.error("could not create the test hospital:", await signup.text());
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
/*
 * This suite deliberately submits a wrong code, and the browser logs the 400
 * that comes back as a console error. A refusal working correctly is not a
 * defect, so those are filtered; anything else — a thrown exception, a broken
 * script, a 500 — is still counted.
 */
const expectedRefusal = (t) => /Failed to load resource.*status of (400|401)/.test(t);
page.on("console", (m) => { if (m.type() === "error" && !expectedRefusal(m.text())) errors.push(m.text()); });

let secret = "";

await part("Signing in shows the enrolment step, not the dashboard", async () => {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button[type="submit"]', { timeout: 20000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');

  await page.waitForSelector("text=Set up two-step sign-in", { timeout: 20000 });
  check("the password alone does not reach the dashboard", !/\/dashboard/.test(page.url()), page.url());
  check("the screen explains why it is being asked", /your hospital requires a second step/i.test(await page.innerText("body")));

  await page.waitForSelector('svg[aria-label="Authenticator setup QR code"]', { timeout: 20000 });
  const box = await page.locator('svg[aria-label="Authenticator setup QR code"]').boundingBox();
  check("a QR code is actually drawn on screen", Boolean(box) && box.width > 100 && box.height > 100,
    box ? `${Math.round(box.width)}×${Math.round(box.height)}` : "not rendered");
});

await part("The setup key is available for a machine with no camera", async () => {
  await page.click("text=No camera? Enter the key by hand");
  await page.waitForTimeout(300);
  const body = await page.innerText("body");
  const match = body.match(/\b[A-Z2-7]{32}\b/);
  check("the base32 key is shown", Boolean(match), (match?.[0] ?? "").slice(0, 8));
  secret = match?.[0] ?? "";
});

await part("A wrong code is refused on screen", async () => {
  const codeBox = page.locator('input[autocomplete="one-time-code"]');
  await codeBox.fill("000000");
  await page.click("text=Turn on two-step sign-in");
  await page.waitForSelector("text=/that code is not right/i", { timeout: 15000 });
  check("the screen says the code is wrong", true);
  check("and it is still the setup screen", /Set up two-step sign-in/.test(await page.innerText("body")));
});

await part("The right code turns it on and shows the backup codes once", async () => {
  const code = await freshCode(secret);
  await page.locator('input[autocomplete="one-time-code"]').fill(code);
  await page.click("text=Turn on two-step sign-in");

  await page.waitForSelector("text=Two-step sign-in is on", { timeout: 20000 });
  const body = await page.innerText("body");
  /* Codes are drawn from the base32 alphabet, so they contain digits 2-7 as
     well as letters — matching only letters finds a handful by luck. */
  const codes = body.match(/\b[a-z2-7]{5}-[a-z2-7]{5}\b/g) ?? [];
  check("ten backup codes are shown", codes.length === 10, `${codes.length} found`);
  check("the screen says they will not be shown again", /only time they will be shown/i.test(body));

  /* The continue button stays disabled until the box is ticked — the whole
     point of the screen is that someone actually writes them down. */
  const cont = page.locator('button:has-text("Continue to the dashboard")');
  check("continuing is blocked until they confirm they saved them", await cont.isDisabled());
  await page.locator('input[type="checkbox"]').check();
  check("and allowed once they have", await cont.isEnabled());
  await cont.click();
  await page.waitForURL(/dashboard|onboarding/, { timeout: 20000 });
  check("the hospital opens", /dashboard|onboarding/.test(page.url()), page.url());
});

await part("Signing in again asks for the code", async () => {
  const fresh = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const p2 = await fresh.newPage();
  await p2.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await p2.waitForSelector('button[type="submit"]', { timeout: 20000 });
  await p2.fill('input[type="email"]', email);
  await p2.fill('input[type="password"]', PASSWORD);
  await p2.click('button[type="submit"]');

  /*
   * Wait for the control, not for a phrase. Waiting on the words "two-step
   * sign-in" matched a line of prose elsewhere on the page and returned before
   * this step had rendered, so the checks below read the previous screen — a
   * test that fails for a reason that has nothing to do with what it is testing.
   */
  await p2.waitForSelector('input[autocomplete="one-time-code"]', { timeout: 20000 });
  const codeScreen = await p2.innerText("body");
  check("the code screen appears", /open your authenticator app/i.test(codeScreen));
  check("and greets the person by name", /hello nandini/i.test(codeScreen));

  await p2.locator('input[autocomplete="one-time-code"]').fill(await freshCode(secret));
  await p2.click("text=Verify and sign in");
  await p2.waitForURL(/dashboard|onboarding/, { timeout: 20000 });
  check("the code opens the hospital", /dashboard|onboarding/.test(p2.url()), p2.url());
  await fresh.close();
});

await part("The security screen reports the true state", async () => {
  await page.goto(`${BASE}/settings/security`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Two-step sign-in", { timeout: 20000 });
  await page.waitForTimeout(1200);
  const body = await page.innerText("body");
  check("it says two-step is on", /\bOn\b/.test(body) && /every sign-in asks/i.test(body));
  check("it counts the backup codes left", /10\s+backup codes left/i.test(body.replace(/\s+/g, " ")), body.slice(0, 0));
  check("it does not offer to turn off what the hospital requires", /cannot be turned off here/i.test(body));
});

await part("Forgotten password does not promise an email", async () => {
  const anon = await browser.newContext();
  const p3 = await anon.newPage();
  await p3.goto(`${BASE}/forgot`, { waitUntil: "domcontentloaded" });
  await p3.fill('input[type="email"]', email);
  await p3.click('button[type="submit"]');
  await p3.waitForSelector("text=Request received", { timeout: 20000 });
  const body = await p3.innerText("body");
  check("it explains an administrator issues the link", /administrator/i.test(body));
  check("it does not say to check an inbox", !/check your (in)?box/i.test(body));
  await anon.close();
});

check("no console errors across the sign-in screens", errors.length === 0, errors.slice(0, 2).join(" | ").slice(0, 160));

await browser.close();
console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);
if (failures.length) {
  console.log("\n\x1b[31mFailures\x1b[0m");
  for (const f of failures) console.log(`  · ${f}`);
}
process.exit(failed ? 1 : 0);
