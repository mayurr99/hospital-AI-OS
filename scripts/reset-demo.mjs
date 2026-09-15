/**
 * Put the demo hospitals back the way they were designed.
 *
 * Why this exists: a demo tenant is the one place in the product where test
 * runs and real content share a database. Every load test, browser test and
 * manual poke writes into DemoCare, and after a few weeks the "demo" a hospital
 * is shown is eight thousand rows of `Ganeshmu27xcvz Pawar` and a staff list
 * full of `UI Test User`. That is worse than no demo — it is a demonstration
 * that the software is full of junk.
 *
 * So this deletes every row belonging to the demo tenants, across every table,
 * and lets the application seed them again from `src/lib/seed.ts` on the next
 * start. Nothing else is touched: a real hospital created through signup, in
 * the same database, is left exactly as it was.
 *
 *   node scripts/reset-demo.mjs            # asks first
 *   node scripts/reset-demo.mjs --yes      # for scripts
 *
 * It refuses to run while a server is using the database, because deleting
 * rows underneath a live process is how you get a half-empty demo and a
 * confusing crash rather than a clean reset.
 */
import { DatabaseSync } from "node:sqlite";
import { createInterface } from "node:readline/promises";
import { createConnection } from "node:net";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = process.env.DATA_DIR ?? path.join(ROOT, ".data");
const DB_PATH = process.env.DATABASE_FILE ?? path.join(DATA_DIR, "hospital-ai-os.db");
const PORT = Number(process.env.PORT ?? 3000);
const yes = process.argv.includes("--yes");

/** The seeded account that belongs to no hospital — it is re-created by the seed. */
const PLATFORM_USER = "usr_platform_root";

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(700);
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
    socket.on("error", () => resolve(false));
  });
}

if (!fs.existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}. Nothing to reset.`);
  process.exit(1);
}

/* Check the obvious ports rather than only the default — people run this on
   3000 and 3100 about equally often. */
for (const p of new Set([PORT, 3000, 3100])) {
  if (await portInUse(p)) {
    console.error(
      `Something is serving on port ${p}. Stop the application first — resetting the\n` +
        `demo underneath a running server leaves it holding rows that no longer exist.`,
    );
    process.exit(1);
  }
}

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = OFF");

const demoOrgs = db.prepare("SELECT id, name FROM organizations WHERE is_demo = 1").all();
if (!demoOrgs.length) {
  console.log("This database holds no demo hospitals — nothing to reset.");
  console.log("Start the app with SEED_DEMO=1 to have them created.");
  db.close();
  process.exit(0);
}

/* Every table carrying an org_id, read from the schema rather than a hand-kept
   list — a table added later would otherwise quietly keep its demo rows. */
const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  .all()
  .map((r) => r.name)
  .filter((t) => db.prepare(`PRAGMA table_info(${t})`).all().some((c) => c.name === "org_id"));

const ids = demoOrgs.map((o) => o.id);
const placeholders = ids.map(() => "?").join(",");

console.log("Demo hospitals in this database:");
for (const o of demoOrgs) {
  const n = db.prepare(`SELECT COUNT(*) c FROM patients WHERE org_id = ?`).get(o.id).c;
  console.log(`  · ${o.name} — ${n} patient${n === 1 ? "" : "s"}`);
}

const otherOrgs = db.prepare("SELECT COUNT(*) c FROM organizations WHERE is_demo = 0").get().c;
console.log(
  otherOrgs
    ? `\n${otherOrgs} real hospital${otherOrgs === 1 ? "" : "s"} in this database will NOT be touched.`
    : "\nThere are no other hospitals in this database.",
);

if (!yes) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("\nDelete all demo data and reseed on next start? Type RESET to confirm: ");
  rl.close();
  if (answer.trim() !== "RESET") {
    console.log("Nothing was changed.");
    db.close();
    process.exit(0);
  }
}

let removed = 0;
db.exec("BEGIN");
try {
  for (const t of tables) {
    const before = db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE org_id IN (${placeholders})`).get(...ids).c;
    if (before) {
      db.prepare(`DELETE FROM ${t} WHERE org_id IN (${placeholders})`).run(...ids);
      removed += before;
      console.log(`  removed ${String(before).padStart(6)} from ${t}`);
    }
  }
  /* The platform account belongs to no hospital, so no org filter reaches it,
     and the seed would fail on its unique email if it were left behind. */
  const platform = db.prepare("DELETE FROM users WHERE id = ?").run(PLATFORM_USER);
  if (platform.changes) console.log(`  removed the seeded platform account`);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(PLATFORM_USER);

  /*
   * Seeded audit rows that ended up with no hospital.
   *
   * These were written by the seed acting as the platform account, so an
   * org filter never reaches them — and because the seed gives them fixed ids
   * (aud_0001…), leaving them behind makes the *next* seeding fail halfway
   * through on a unique-id collision. Matched by that exact four-digit shape,
   * which nothing generated at runtime uses.
   */
  const strays = db
    .prepare("DELETE FROM audit_logs WHERE org_id IS NULL AND id GLOB 'aud_[0-9][0-9][0-9][0-9]'")
    .run();
  if (strays.changes) console.log(`  removed ${strays.changes} seeded audit rows that had no hospital`);

  db.prepare(`DELETE FROM organizations WHERE id IN (${placeholders})`).run(...ids);
  db.exec("COMMIT");
} catch (e) {
  db.exec("ROLLBACK");
  console.error("\nNothing was changed — the delete failed and was rolled back:");
  console.error(String(e?.message ?? e));
  db.close();
  process.exit(1);
}

const left = db.prepare("SELECT COUNT(*) c FROM organizations").get().c;
db.close();

console.log(`\nRemoved ${removed} rows. ${left} hospital${left === 1 ? "" : "s"} left in the database.`);
console.log("\nStart the application and the demo hospitals will be created fresh:");
console.log("  SEED_DEMO=1 npm start      (or: npm run dev)");
