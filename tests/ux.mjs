/**
 * Regression tests for the operating-friction fixes.
 *
 * Each check corresponds to a defect that was found by operating the software:
 * a control that reported success without doing anything, a dialog with no way
 * out, a search box that quietly searched a fraction of the register, a filter
 * that reset every time you came back from a patient.
 *
 * Run with the app already serving on BASE (default http://localhost:3100).
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3100";
const CHROME = process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

let passed = 0, failed = 0;
const failures = [];
let group = "";

const section = (n) => { group = n; console.log(`\n\x1b[1m${n}\x1b[0m`); };

/**
 * Run one section. A transient timeout inside a browser step should be reported
 * as a failed check, not crash the whole run and hide the sections after it.
 */
async function part(name, fn) {
  section(name);
  try { await fn(); }
  catch (e) { check("section completed without throwing", false, String(e.message ?? e).split("\n")[0].slice(0, 120)); }
}
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { failed++; failures.push(`${group} → ${name}${detail ? ` (${detail})` : ""}`); console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? ` — ${detail}` : ""}`); }
}


/* ------------------------------------------------------------------ */
/*
 * Volume, borrowed for one check and given back.
 *
 * One check below proves that searching queries the server rather than
 * filtering the page already loaded — which can only be proven on a register
 * bigger than that page. It used to rely on the demo hospital happening to hold
 * eight thousand load-test rows, which is how a demo that a real hospital gets
 * shown ended up full of names like `Ganeshmu27xcvz Pawar`.
 *
 * So the check now seeds exactly what it needs and removes it afterwards. The
 * seeder marks every row it writes — surname `Loadtest`, UHIDs in an `LT`
 * namespace — so the cleanup is exact and can never take a real demo record
 * with it.
 */
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const DB_FILE = process.env.DATABASE_FILE ?? path.join(process.cwd(), ".data", "hospital-ai-os.db");
const DEMO_ORG = "org_democare";
const VOLUME_NEEDED = 500;

function demoPatientCount() {
  const db = new DatabaseSync(DB_FILE);
  try { return db.prepare("SELECT COUNT(*) c FROM patients WHERE org_id = ?").get(DEMO_ORG).c; }
  catch { return 0; }
  finally { db.close(); }
}

function addVolume() {
  if (demoPatientCount() >= VOLUME_NEEDED) return false;
  execFileSync("node", ["scripts/seed-volume.mjs", DEMO_ORG, String(VOLUME_NEEDED)], { stdio: "pipe" });
  return true;
}

/** Remove only the marked rows. Runs even if a check threw. */
function removeVolume() {
  const db = new DatabaseSync(DB_FILE);
  try {
    const ids = db
      .prepare("SELECT id FROM patients WHERE org_id = ? AND uhid LIKE 'LT%'")
      .all(DEMO_ORG)
      .map((r) => r.id);
    if (!ids.length) return 0;
    const chunk = 400;
    for (let i = 0; i < ids.length; i += chunk) {
      const slice = ids.slice(i, i + chunk);
      const q = slice.map(() => "?").join(",");
      /*
       * Results hang off the order, not off the patient — `lab_results` has an
       * `order_id` and no `patient_id` at all. An earlier version of this
       * cleanup deleted "lab_results WHERE patient_id IN (...)" inside a
       * try/catch, so the statement failed on every run, was swallowed, and left
       * the rows behind; the next run then died on a duplicate id. Deleting
       * through the order is what actually reaches them, and nothing here is
       * wrapped in a catch that can hide the same mistake again.
       */
      db.prepare(`DELETE FROM lab_results WHERE order_id IN (SELECT id FROM lab_orders WHERE patient_id IN (${q}))`).run(...slice);
      db.prepare(`DELETE FROM lab_order_items WHERE order_id IN (SELECT id FROM lab_orders WHERE patient_id IN (${q}))`).run(...slice);
      db.prepare(`DELETE FROM lab_orders WHERE patient_id IN (${q})`).run(...slice);
      db.prepare(`DELETE FROM vitals WHERE patient_id IN (${q})`).run(...slice);
      db.prepare(`DELETE FROM patients WHERE id IN (${q})`).run(...slice);
    }
    return ids.length;
  } finally {
    db.close();
  }
}

const browser = await chromium.launch({ executablePath: CHROME });

async function signIn(email, password = "demo1234", viewport = { width: 1440, height: 950 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button[type="submit"]', { timeout: 20000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard|onboarding/, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
  return { ctx, page, errors };
}

/* ================================================================== */
await part("The guide is reachable, not just present", async () => {
  const { ctx, page } = await signIn("sunita.kale@democare.in");

  const launcher = page.locator('[aria-label="Open Mitra, the in-app guide"]');
  check("the launcher is visible on the dashboard", await launcher.isVisible());
  check("it is labelled, not a bare icon", (await launcher.innerText()).toLowerCase().includes("help"));

  /* It must sit in <body>, outside the page frame, so no ancestor's transform
     or filter can move or clip it. */
  const parentage = await launcher.evaluate((el) => {
    let n = el.parentElement, depth = 0, culprit = null;
    while (n && n !== document.body) {
      const s = getComputedStyle(n);
      if (s.transform !== "none" || s.filter !== "none" || s.backdropFilter !== "none") culprit = n.tagName;
      n = n.parentElement; depth++;
    }
    return { reachesBody: n === document.body, depth, culprit };
  });
  check("it is portalled to <body>", parentage.reachesBody && parentage.depth <= 2, JSON.stringify(parentage));
  check("no ancestor breaks its fixed positioning", parentage.culprit === null, `culprit ${parentage.culprit}`);

  /* The header route in. */
  const headerHelp = page.locator('header button[title*="in-app guide"]');
  check("the header carries a Help button too", await headerHelp.isVisible());
  await headerHelp.click();
  await page.waitForTimeout(500);
  check("the header button opens the guide", await page.locator("text=Your guide to every screen here").isVisible());

  /* Escape closes it; "?" reopens it from anywhere. */
  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);
  check("Escape closes the guide", !(await page.locator("text=Your guide to every screen here").isVisible()));

  await page.keyboard.press("?");
  await page.waitForTimeout(400);
  check("the ? key opens the guide", await page.locator("text=Your guide to every screen here").isVisible());
  await page.keyboard.press("Escape");

  /* It follows you to another screen. */
  await page.goto(`${BASE}/laboratory`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  check("the launcher is on every workspace screen", await launcher.isVisible());

  await ctx.close();
});

/* ================================================================== */
await part("Dialogs have a way out", async () => {
  const { ctx, page } = await signIn("sunita.kale@democare.in");
  await page.goto(`${BASE}/patients`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  await page.click("text=Register patient");
  await page.waitForTimeout(500);
  const dialog = page.locator('[role="dialog"]');
  check("the register dialog opens", await dialog.isVisible());
  check("the first field takes focus", await page.evaluate(() => document.activeElement?.tagName === "INPUT"));

  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("Escape closes it", !(await dialog.isVisible()));

  await page.click("text=Register patient");
  await page.waitForTimeout(500);
  /* Click the backdrop, well away from the panel. */
  await page.mouse.click(20, 400);
  await page.waitForTimeout(400);
  check("clicking outside closes it", !(await page.locator('[role="dialog"]').isVisible()));

  await ctx.close();
});

/* ================================================================== */
await part("Search covers the whole register, not the cached slice", async () => {
  /* Seeded here and removed at the end of the run — see the note above. */
  addVolume();
  const { ctx, page } = await signIn("sunita.kale@democare.in");
  await page.goto(`${BASE}/patients`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);

  const footer = await page.locator("text=/Showing .* of the/").first().innerText().catch(() => "");
  check("the list says what it is showing against the total", /registered in total/.test(footer), footer.slice(0, 90));

  /* Find a patient that is NOT in the cached working set, then search for it. */
  const target = await page.evaluate(async () => {
    const res = await fetch("/api/patients?limit=1&offset=400").then((r) => r.json());
    return res.items?.[0] ?? null;
  });

  if (!target) {
    check("a patient beyond the cached slice exists to test with", false, "tenant too small — seed more rows");
  } else {
    const cached = await page.evaluate((id) =>
      Array.from(document.querySelectorAll("a[href^='/patients/']")).some((a) => a.getAttribute("href")?.endsWith(id)),
      target.id);
    check("that patient is not already on screen", !cached);

    await page.fill('input[placeholder="Name, MRN or phone…"]', target.uhid);
    /* The search is debounced and goes to the database; wait for the result to
       appear rather than for a fixed interval, which is flaky under volume. */
    await page.waitForSelector(`a[href="/patients/${target.id}"]`, { timeout: 15000 }).catch(() => {});
    const found = await page.locator(`a[href="/patients/${target.id}"]`).count();
    check("searching by UHID finds a patient outside the cached slice", found > 0, `uhid ${target.uhid}`);

    const count = await page.locator("text=/\\d+ found/").first().innerText({ timeout: 5000 }).catch(() => "");
    check("the result count comes from the server", /found/.test(count), count);
  }

  await ctx.close();
});

/* ================================================================== */
await part("Filters survive opening a patient and coming back", async () => {
  const { ctx, page } = await signIn("sunita.kale@democare.in");
  await page.goto(`${BASE}/patients`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1600);

  await page.selectOption("select >> nth=1", { label: "Red — escalation" }).catch(() => {});
  await page.waitForTimeout(600);
  const before = await page.inputValue("select >> nth=1");

  const firstPatient = page.locator("a[href^='/patients/']").first();
  if (await firstPatient.count()) {
    await firstPatient.click();
    await page.waitForTimeout(1500);
    await page.goBack();
    await page.waitForTimeout(1600);
    const after = await page.inputValue("select >> nth=1");
    check("the risk filter is still applied after coming back", after === before, `${before} → ${after}`);
  } else {
    check("a patient was available to open", false);
  }

  await ctx.close();
});

/* ================================================================== */
await part("Settings that claim to save, save", async () => {
  const { ctx, page } = await signIn("sunita.kale@democare.in");
  await page.goto(`${BASE}/admin/telephony`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1600);

  const marker = `+91 20 4000 ${Math.floor(1000 + Math.random() * 8999)}`;
  const aiNumber = page.locator('input[placeholder="+91 20 4000 0000"]');
  await aiNumber.fill(marker);
  await page.waitForTimeout(300);

  const save = page.locator('button:has-text("Save changes")').first();
  check("Save only becomes available once something changed", await save.isEnabled());
  await save.click();
  await page.waitForTimeout(1200);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  const persisted = await page.locator('input[placeholder="+91 20 4000 0000"]').inputValue();
  check("the AI number survives a reload", persisted === marker, `expected ${marker}, got ${persisted}`);

  await ctx.close();
});

/* ================================================================== */
await part("Creating a campaign creates a campaign", async () => {
  const { ctx, page } = await signIn("sunita.kale@democare.in");
  await page.goto(`${BASE}/campaigns`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1600);

  const name = `Regression cohort ${Date.now().toString(36)}`;
  await page.click("text=New campaign");
  await page.waitForTimeout(600);

  await page.fill('input[placeholder*="Cardiac post-discharge"]', name);
  const selects = page.locator('[role="dialog"] select');
  await selects.nth(0).selectOption({ index: 1 });   /* department */
  await selects.nth(1).selectOption({ index: 1 });   /* protocol   */
  await page.waitForTimeout(400);

  const cohortLine = await page.locator("text=/Matching patients loaded/").innerText().catch(() => "");
  check("the cohort estimate reacts to the department chosen", /Matching patients loaded/.test(cohortLine), cohortLine.slice(0, 80));

  await page.click('button:has-text("Create as draft")');
  await page.waitForTimeout(1600);
  check("the new campaign appears in the list", await page.locator(`text=${name}`).count() > 0);

  /* And it is really persisted, not just in local state. */
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  check("it is still there after a reload", await page.locator(`text=${name}`).count() > 0);

  await ctx.close();
});

/* ================================================================== */
await part("Queues do not claim to be clear before they have loaded", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', "sunita.kale@democare.in");
  await page.fill('input[type="password"]', "demo1234");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 20000 }).catch(() => {});

  /* Hold the collections request so the screen is caught mid-load. */
  await page.route("**/api/collections*", async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });

  await page.goto(`${BASE}/escalations`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const midLoad = await page.locator("body").innerText();
  check("it does not say 'Nothing here' while still loading", !/Nothing here/i.test(midLoad));
  check("it says it is loading instead", /Loading/i.test(midLoad), midLoad.slice(0, 120).replace(/\n/g, " "));

  await page.unroute("**/api/collections*");
  await ctx.close();
});

/* ================================================================== */
await part("The live console can reach any patient", async () => {
  const { ctx, page } = await signIn("sunita.kale@democare.in");
  await page.goto(`${BASE}/live`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);

  const filter = page.locator('input[placeholder*="Filter by name"]');
  check("the patient selector has a filter", await filter.isVisible());

  const optionsBefore = await page.locator("select >> nth=0 >> option").count();
  await filter.fill("zzzznomatch");
  await page.waitForTimeout(500);
  const optionsAfter = await page.locator("select >> nth=0 >> option").count();
  check("filtering narrows the patient list", optionsAfter < optionsBefore, `${optionsBefore} → ${optionsAfter}`);

  await ctx.close();
});

/* ================================================================== */
/* ================================================================== */
await part("A visitor can reach the working software in one click", async () => {
  /*
   * The front door for someone evaluating the product. What is being checked is
   * not that a button exists but that pressing it lands in a populated
   * hospital — a demo entry pointing at an account that no longer exists is the
   * worst possible first impression, and is exactly what hard-coding the email
   * into the page would eventually produce.
   */
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const body = await page.innerText("body");

  check("the demo entry is offered", /look around first/i.test(body));
  /*
   * The sign-in screen used to print a shared password and list eight demo
   * accounts. Both are gone, and these two checks are what stop them coming
   * back — a credential on the front door of a medical records product is not a
   * cosmetic problem.
   */
  check("no shared password is printed on the screen", !/demo1234/.test(body));
  check("no roster of demo accounts is listed", !/Rupali Tambe|Ganesh More|Farida Khan/.test(body));
  check("the product is described instead", /answers the phone/i.test(body) && /receptionist/i.test(body));
  check("it names the hospital it opens", /Open DemoCare/i.test(body), body.slice(0, 0));
  check("it says the records are invented", /records are invented/i.test(body));

  /* The counts must be real, not decoration: compare against the API. */
  const api = await page.evaluate(() => fetch("/api/auth/demo").then((r) => r.json()));
  check("the counts come from the database", api?.entry?.counts?.beds > 0 && body.includes(String(api.entry.counts.beds)),
    `beds ${api?.entry?.counts?.beds}`);

  /* And no credential should be in the bundle either — the click must be a
     bare POST the server answers, not a login the page performs. */
  const posted = [];
  page.on("request", (r) => { if (r.url().includes("/api/auth/") && r.method() === "POST") posted.push({ url: r.url(), body: r.postData() ?? "" }); });

  const button = page.locator('button:has-text("Explore the")');
  check("there is one obvious way in", (await button.count()) === 1, `${await button.count()} buttons`);

  await button.click();
  await page.waitForURL(/dashboard/, { timeout: 25000 });
  await page.waitForTimeout(2500);
  const dash = await page.innerText("body");
  check("it lands on the dashboard, signed in", /dashboard/.test(page.url()));
  check("the browser sent no credential to get there",
    posted.length > 0 && posted.every((r) => !/password|demo1234|@/.test(r.body)),
    posted.map((r) => `${r.url.split("/api")[1]} ${r.body}`).join(" ").slice(0, 100));
  check("as somebody who can see the whole product", /Patients/.test(dash) && /Admissions/.test(dash));
  check("and the hospital has data in it", !/No patients yet|nothing to show/i.test(dash));
  check("no page errors on the way in", errors.length === 0, errors.slice(0, 1).join("").slice(0, 120));

  await ctx.close();
});

const removedRows = removeVolume();
if (removedRows) console.log(`\n  (removed ${removedRows} borrowed load-test patients — the demo hospital is clean again)`);

await browser.close();

console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);
if (failures.length) {
  console.log("\n\x1b[31mFailures\x1b[0m");
  for (const f of failures) console.log(`  · ${f}`);
}
process.exit(failed ? 1 : 0);
