/**
 * Browser tests for the clinical screens.
 *
 * Drives a real browser through the import wizard, the patient profile, the
 * ward board and the laboratory workbench, then reloads to prove the writes
 * actually reached the database rather than component state.
 */

import { chromium } from "playwright";
import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = "/tmp/clinical-ui";
fs.mkdirSync(OUT, { recursive: true });

let passed = 0;
let failed = 0;
const failures = [];

function record(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` (${detail})` : ""}`);
    console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? ` — ${detail}` : ""}`);
  }
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const errors = [];

async function session(email, password = "demo1234") {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await ctx.newPage();
  page.on("console", (m) => {
    const t = m.text();
    // A 403 on a page the role cannot see is the access control working, not a bug.
    if (m.type() === "error" && !/favicon|Download the React|status of 403/.test(t)) errors.push(t);
  });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.waitForFunction(() => {
    const b = document.querySelector('button[type="submit"]');
    return b && !b.disabled;
  });
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|portal)/, { timeout: 25000 });
  await page.waitForTimeout(1200);
  return { ctx, page };
}

const text = (page) => page.evaluate(() => document.body.innerText);

async function clickText(page, label) {
  await page.locator(`text=${label}`).first().click();
  await page.waitForTimeout(600);
}

/** Tab strips are buttons; "Vitals" also appears as card text, so scope by role. */
async function clickTab(page, label) {
  await page.getByRole("button", { name: new RegExp(`^${label}`), exact: false }).first().click();
  await page.waitForTimeout(800);
}

/* ---------------------------- 1. import wizard --------------------------- */
console.log("\n\x1b[1mImport wizard\x1b[0m");
{
  const { ctx, page } = await session("sunita.kale@democare.in");

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("PATIENTS");
  ws.addRow(["Patient ID", "Patient Name", "Birth Date", "Sex", "Phone Number", "Blood", "Pin Code", "Allergies"]);
  // Unique per run so the suite is repeatable against a database that already
  // holds the previous run's import.
  const stamp = Date.now().toString(36);
  const first = `Ganesh${stamp}`;
  const tail = String(Math.floor(1000 + Math.random() * 8999));
  ws.addRow([`UI-${stamp}-1`, `${first} Balaji Pawar`, "1979-11-02", "M", `98201${tail}0`, "B+", "411014", "Sulfa"]);
  ws.addRow([`UI-${stamp}-2`, `Meera${stamp} Joshi`, "1986-06-21", "F", `98201${tail}1`, "O+", "411015", ""]);
  ws.addRow([`UI-${stamp}-3`, `Broken${stamp} Row`, "2099-01-01", "M", "123", "Z+", "411016", ""]);
  const file = path.join(OUT, "ui-import.xlsx");
  await wb.xlsx.writeFile(file);

  await page.goto(`${BASE}/patients/import`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  record("import wizard loads", (await text(page)).includes("Import patients"));

  await page.setInputFiles('input[type="file"]', file);
  await page.waitForTimeout(4000);
  const preview = await text(page);
  await page.screenshot({ path: `${OUT}/import-preview.png`, fullPage: true });

  record("preview reached without writing", /Total rows|Column mapping/.test(preview), preview.slice(0, 160));

  // If the wizard stopped on mapping (unrecognised headers), continue through it.
  if (preview.includes("Column mapping")) {
    await page.locator("button", { hasText: "Re-validate with this mapping" }).first().click();
    await page.waitForTimeout(4000);
  }

  const preview2 = await text(page);
  record("row counts shown", /Total rows/.test(preview2), preview2.slice(0, 200));
  record("invalid row surfaced", /1\s*$|rejected|INVALID/m.test(preview2) || preview2.includes("INVALID"));

  const before = await page.evaluate(async (q) => {
    const r = await fetch(`/api/patients?q=${q}`);
    return (await r.json()).total;
  }, first);
  record("nothing written before commit", before === 0, `total=${before}`);

  await page.locator("button", { hasText: "Import " }).first().click();
  await page.waitForTimeout(5000);
  const done = await text(page);
  await page.screenshot({ path: `${OUT}/import-done.png`, fullPage: true });
  record("results screen shown", done.includes("Import complete"), done.slice(0, 200));

  const after = await page.evaluate(async (q) => {
    const r = await fetch(`/api/patients?q=${q}`);
    return (await r.json()).total;
  }, first);
  record("patient exists in the database after commit", after === 1, `total=${after}`);

  const errCsv = await page.evaluate(async () => {
    const rows = await (await fetch("/api/import")).json();
    const id = rows.batches[0]?.id;
    const res = await fetch(`/api/import/${id}/errors`);
    return (await res.text()).slice(0, 400);
  });
  record("error report is downloadable and names the problem", /mobile|blood|future/i.test(errCsv), errCsv.slice(0, 120));

  await ctx.close();
}

/* --------------------------- 2. patient profile -------------------------- */
console.log("\n\x1b[1mPatient profile\x1b[0m");
let patientId = null;
{
  // A nurse, because recording vitals is a clinical action — a hospital
  // administrator deliberately does not carry it.
  const { ctx, page } = await session("r.tambe@democare.in");
  await page.goto(`${BASE}/patients`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.locator("tbody tr a").first().click();
  await page.waitForTimeout(2000);
  patientId = page.url().split("/patients/")[1];
  await page.waitForSelector("text=Current admission", { timeout: 20000 });
  await page.waitForTimeout(600);

  const body = await text(page);
  await page.screenshot({ path: `${OUT}/profile-overview.png`, fullPage: true });
  const upper = body.toUpperCase();
  const missing = ["Current admission", "Allergies", "Latest vitals", "Active medications"]
    .filter((k) => !upper.includes(k.toUpperCase()));
  record("profile shows the key facts band", missing.length === 0, `missing: ${missing.join(", ")}`);

  for (const tabName of ["Timeline", "Encounters", "Admissions", "Vitals", "Diagnoses", "Medications", "Labs", "Audit history"]) {
    await clickTab(page, tabName);
    const t = await text(page);
    record(`${tabName} tab renders`, t.length > 200 && !t.includes("Application error"), t.slice(0, 80));
  }
  await page.screenshot({ path: `${OUT}/profile-timeline.png`, fullPage: true });

  // record vitals through the UI and confirm they survive a reload
  await clickTab(page, "Record vitals");
  await page.waitForTimeout(700);
  await page.locator('input[type="number"]').nth(0).fill("132");
  await page.locator('input[type="number"]').nth(1).fill("84");
  await page.locator('input[type="number"]').nth(2).fill("77");
  await page.locator("button", { hasText: "Save vitals" }).first().click();
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await clickTab(page, "Vitals");
  const vitalsText = await text(page);
  await page.screenshot({ path: `${OUT}/profile-vitals.png`, fullPage: true });
  record("vitals recorded through the UI persist after a reload", vitalsText.includes("132/84"), vitalsText.slice(0, 200));

  await ctx.close();
}

/* ------------------------------ 3. ward board ---------------------------- */
console.log("\n\x1b[1mWard board and admissions\x1b[0m");
{
  const { ctx, page } = await session("r.tambe@democare.in");
  await page.goto(`${BASE}/admissions`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const board = await text(page);
  await page.screenshot({ path: `${OUT}/ward-board.png`, fullPage: true });
  record("ward board renders with bed states", /Ward board|Beds/.test(board) && /OCCU|AVAI/.test(board), board.slice(0, 200));

  await clickTab(page, "Bed management");
  await page.waitForTimeout(1200);
  const bedsText = await text(page);
  record("bed management lists beds with status", /AVAILABLE|OCCUPIED/.test(bedsText));

  await clickTab(page, "Current admissions");
  await page.waitForTimeout(1200);
  const admText = await text(page);
  await page.screenshot({ path: `${OUT}/current-admissions.png`, fullPage: true });
  record("current admissions listed", /IP\d{9}|No active admissions/.test(admText), admText.slice(0, 160));

  await page.goto(`${BASE}/ipd`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  record("legacy /ipd redirects to the new screen", page.url().includes("/admissions"), page.url());

  await ctx.close();
}

/* ---------------------------- 4. lab workbench --------------------------- */
console.log("\n\x1b[1mLaboratory workbench\x1b[0m");
{
  const { ctx, page } = await session("a.deshmukh@democare.in");

  // Order a test from the patient profile so the board has something to move.
  await page.goto(`${BASE}/patients/${patientId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);
  await clickTab(page, "Order lab");
  await page.waitForTimeout(800);
  await page.locator("select").first().selectOption({ index: 1 });
  await page.getByRole("button", { name: "Order", exact: true }).first().click();
  await page.waitForTimeout(3000);

  await ctx.close();

  // The lab board is worked by the laboratory, not by the ordering doctor: a
  // doctor can order a test but cannot collect, result or verify it.
  const labSession = await session("s.dhumal@democare.in");
  const page2 = labSession.page;

  await page2.goto(`${BASE}/laboratory`, { waitUntil: "networkidle" });
  await page2.waitForTimeout(2000);
  const lab = await text(page2);
  await page2.screenshot({ path: `${OUT}/lab-board.png`, fullPage: true });
  record("workflow columns render", /Ordered/i.test(lab) && /Awaiting verification/i.test(lab) && /Released/i.test(lab));

  const card = page2.locator("button", { hasText: /LAB\d{9}/ }).first();
  if (await card.count()) {
    await card.click();
    await page2.waitForTimeout(1200);
    const drawer = await text(page2);
    record("order drawer opens with the workflow action",
      /Collect sample|Start processing|Save results|Verify/i.test(drawer), drawer.slice(-300));
    await page2.screenshot({ path: `${OUT}/lab-order.png`, fullPage: true });

    // Drive one real workflow step through the UI and confirm it stuck.
    const collect = page2.getByRole("button", { name: "Collect sample" });
    if (await collect.count()) {
      await collect.first().click();
      await page2.waitForTimeout(2500);
      const after = await text(page2);
      record("collecting the sample moves the order through the workflow",
        /SAMPLE_COLLECTED|Start processing/i.test(after), after.slice(-200));
    } else {
      record("collecting the sample moves the order through the workflow", false, "collect action not offered");
    }
  } else {
    record("order drawer opens with the workflow action", false, "no order card found on the board");
    record("collecting the sample moves the order through the workflow", false, "no order card found");
  }

  await labSession.ctx.close();
}

/* ------------------------- 5. least privilege in UI ---------------------- */
console.log("\n\x1b[1mRole restrictions\x1b[0m");
{
  const cases = [
    ["g.more@democare.in", "/laboratory", false, "reception blocked from the laboratory"],
    ["g.more@democare.in", "/patients/import", true, "reception can import patients"],
    ["f.khan@democare.in", "/admissions", false, "billing blocked from the ward board"],
    ["r.tambe@democare.in", "/admissions", true, "nurse sees the ward board"],
  ];
  for (const [email, route, allowed, label] of cases) {
    const { ctx, page } = await session(email);
    await page.goto(BASE + route, { waitUntil: "networkidle" });
    await page.waitForTimeout(1400);
    const t = await text(page);
    const denied = /not available for your role|do not have permission|Access restricted/i.test(t);
    record(label, allowed ? !denied : denied, t.slice(0, 100));
    await ctx.close();
  }
}

/* ------------------ 6. reception cannot read clinical data ---------------- */
console.log("\n\x1b[1mClinical data is withheld, not hidden\x1b[0m");
{
  const { ctx, page } = await session("g.more@democare.in");
  const payload = await page.evaluate(async (pid) => {
    const r = await fetch(`/api/patients/${pid}`);
    return await r.json();
  }, patientId);
  record("reception's profile payload carries no clinical arrays",
    payload.clinicalVisible === false && (payload.vitals ?? []).length === 0 && (payload.medications ?? []).length === 0,
    `clinicalVisible=${payload.clinicalVisible} vitals=${(payload.vitals ?? []).length}`);
  await ctx.close();
}

/* ----------------------------- 7. the guide bot -------------------------- */
console.log("\n\x1b[1mMitra, the in-app guide\x1b[0m");
{
  const { ctx, page } = await session("r.tambe@democare.in");
  await page.waitForTimeout(2200);

  record("first-visit nudge appears", (await text(page)).includes("Not now"));

  await page.getByRole("button", { name: /Open Mitra/ }).click()
    .catch(() => page.locator("text=Yes, show me").click());
  await page.waitForTimeout(1000);
  const panel = await text(page);
  record("panel explains the screen you are on", panel.includes("Mitra") && panel.includes("Dashboard"));

  await page.locator("text=All sections").click();
  await page.waitForTimeout(600);
  await page.fill("#mitra-search", "bed");
  await page.waitForTimeout(500);
  record("search finds a section by what it does",
    (await text(page)).includes("Admissions & wards"));

  await page.fill("#mitra-search", "");
  await page.locator("text=Guided tour").click();
  await page.waitForTimeout(1600);
  for (let i = 0; i < 4; i++) {
    await page.getByRole("button", { name: /^Next/ }).click();
    await page.waitForTimeout(1400);
  }
  record("the tour actually navigates the app", page.url().includes("/admissions"), page.url());

  // The guide must not claim a broken screen works.
  await page.goto(`${BASE}/ot`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  await page.getByRole("button", { name: /Open Mitra/ }).click().catch(() => {});
  await page.waitForTimeout(900);
  record("the guide admits the OT screen cannot schedule",
    (await text(page)).includes("Not built yet"));

  await ctx.close();
}

{
  // Reception cannot open the laboratory, so the guide must not offer it.
  const { ctx, page } = await session("g.more@democare.in");
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: /Open Mitra/ }).click()
    .catch(() => page.locator("text=Yes, show me").click());
  await page.waitForTimeout(800);
  await page.locator("text=All sections").click();
  await page.waitForTimeout(700);
  const listed = await text(page);
  record("the guide hides screens this role cannot reach",
    !listed.includes("Laboratory") && listed.includes("Import patients"),
    listed.includes("Laboratory") ? "laboratory was offered to reception" : "");
  await ctx.close();
}

record("no console errors across the clinical screens", errors.length === 0, errors[0] ?? "");


console.log("\n\x1b[1mCancelling a dialog discards what was typed in it\x1b[0m");
{
  const { ctx, page } = await session("a.deshmukh@democare.in");
  const first = (await page.evaluate(async () => {
    const r = await fetch("/api/patients?limit=1").then((x) => x.json());
    return r.items?.[0]?.id ?? null;
  }));

  if (!first) {
    record("a patient was available", false);
  } else {
    await page.goto(`${BASE}/patients/${first}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    /* Type into Record vitals, then cancel. */
    await page.click("text=Record vitals");
    await page.waitForTimeout(600);
    const pulse = page.locator('[role="dialog"] input[type="number"]').first();
    await pulse.fill("88");
    record("a value was entered into the vitals dialog", (await pulse.inputValue()) === "88");
    await page.click('[role="dialog"] >> text=Cancel');
    await page.waitForTimeout(500);

    /* Re-open it: the cancelled value must be gone. */
    await page.click("text=Record vitals");
    await page.waitForTimeout(600);
    const reopened = await page.locator('[role="dialog"] input[type="number"]').first().inputValue();
    record("re-opening the same dialog starts empty", reopened === "", `got "${reopened}"`);
    await page.click('[role="dialog"] >> text=Cancel');
    await page.waitForTimeout(400);

    /*
     * And the value must not appear in a *different* dialog's request. This is
     * the one that mattered clinically: every field in the shared form object is
     * spread into the body, so a cancelled blood pressure could be submitted as
     * part of a prescription.
     */
    await page.click("text=Overview").catch(() => {});
    await page.waitForTimeout(400);
    const prescribe = page.locator("text=Prescribe").first();
    if (await prescribe.count()) {
      let sent = null;
      page.on("request", (r) => {
        if (r.method() === "POST" && r.url().includes("/medications")) {
          try { sent = JSON.parse(r.postData() ?? "{}"); } catch { sent = {}; }
        }
      });
      await prescribe.click();
      await page.waitForTimeout(600);
      await page.locator('[role="dialog"] input').first().fill(`Amoxicillin${Date.now().toString(36).slice(-4)}`);
      await page.click('[role="dialog"] >> text=Prescribe').catch(() => {});
      await page.waitForTimeout(1500);
      record("a prescription carries no vitals from the cancelled dialog",
        !sent || (sent.pulse === undefined && sent.systolic === undefined),
        JSON.stringify(sent ?? {}).slice(0, 140));
    }
  }
  await ctx.close();
}

await browser.close();
/* ------------------------------------------------------------------ */
/* One form, nine dialogs — cancelled values must not follow you       */
/* ------------------------------------------------------------------ */
console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed ? 1 : 0);
