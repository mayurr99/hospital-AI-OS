/**
 * Preflight.
 *
 * Two failures have cost real time, and both look like the software is broken
 * when it is only mis-started. This catches them before Next.js boots.
 *
 *  1. Node older than 22.5 has no built-in SQLite, so every API route fails to
 *     load and the browser reports `Unexpected token '<', "<!DOCTYPE "...`,
 *     which explains nothing.
 *
 *  2. A server already listening on the port. `next start` prints EADDRINUSE
 *     and exits, the old process keeps serving the *previous* build, and the
 *     page looks unchanged no matter how many times you rebuild. This is the
 *     single most confusing state the product can be in: new code on disk, old
 *     code on screen.
 */
import net from "node:net";
import fs from "node:fs";
import path from "node:path";

const [major, minor] = process.versions.node.split(".").map(Number);
if (!(major > 22 || (major === 22 && minor >= 5))) {
  console.error(`
  ────────────────────────────────────────────────────────────────────────
  Hospital AI OS needs Node 22.5 or newer.
  You are running Node ${process.versions.node}, which has no built-in SQLite.

    nvm install 22 && nvm use 22     (or install Node 22 LTS from nodejs.org)
    rm -rf node_modules .next
    npm install
    npm run dev
  ────────────────────────────────────────────────────────────────────────
`);
  process.exit(1);
}

/* Only the commands that bind a port need the rest of this check. */
const mode = process.argv[2];
if (mode !== "serve") process.exit(0);

const PORT = Number(process.env.PORT ?? 3000);

const inUse = await new Promise((resolve) => {
  const probe = net.createServer();
  probe.once("error", (e) => resolve(e.code === "EADDRINUSE"));
  probe.once("listening", () => probe.close(() => resolve(false)));
  probe.listen(PORT, "0.0.0.0");
});

if (inUse) {
  console.error(`
  ────────────────────────────────────────────────────────────────────────
  Port ${PORT} is already in use.

  Something is already serving on this port — almost certainly an older copy
  of this app left running. If you start another one now it will fail, the
  old one will keep answering, and your browser will show the PREVIOUS build
  however many times you rebuild.

  Stop the old server first:

    macOS / Linux   lsof -ti:${PORT} | xargs kill -9
    Windows         netstat -ano | findstr :${PORT}      then  taskkill /PID <pid> /F

  Or run this one somewhere else:   PORT=3001 npm run dev
  ────────────────────────────────────────────────────────────────────────
`);
  process.exit(1);
}

/* A build older than the source it was built from is the other silent trap. */
try {
  const buildStamp = path.join(process.cwd(), ".next", "BUILD_ID");
  if (fs.existsSync(buildStamp) && process.env.npm_lifecycle_event === "start") {
    const builtAt = fs.statSync(buildStamp).mtimeMs;
    let newest = 0;
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else newest = Math.max(newest, fs.statSync(p).mtimeMs);
      }
    };
    walk(path.join(process.cwd(), "src"));
    if (newest > builtAt) {
      console.error(`
  ────────────────────────────────────────────────────────────────────────
  Your build is older than your code.

  Files under src/ changed after the last "npm run build", so "npm start"
  would serve the old version. Rebuild first:

    npm run build && npm start
  ────────────────────────────────────────────────────────────────────────
`);
      process.exit(1);
    }
  }
} catch {
  /* The staleness check is a convenience — never block a start because of it. */
}
