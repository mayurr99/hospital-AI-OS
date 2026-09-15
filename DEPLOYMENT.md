# Where this can run, and where it cannot

Hospital AI OS keeps everything — patients, admissions, sessions, the audit
trail — in a **single SQLite file** on disk, written by a **long-running Node
process**. That choice is why it needs no database server, no Redis and no
cloud account to run a hospital. It is also the entire answer to where it can be
deployed.

Two things are required, and they are not negotiable:

1. **A writable disk that survives restarts.** The database is a file.
2. **One long-running process** (or one per machine, with a shared disk). Live
   updates and rate limiting are held in memory in that process.

---

## Netlify and Vercel will not work

This is not a configuration problem and there is no flag that fixes it.

Netlify's Next.js runtime turns the application into **serverless functions**.
Those have a **read-only filesystem** apart from `/tmp`, and each invocation may
run in a **different, short-lived container**. So:

- The first write fails. Signing in creates a session row, so the failure lands
  on the login screen — which is why the demo button returns
  *"attempt to write a readonly database"*.
- Even if it could write to `/tmp`, the next request might reach a different
  container that has never seen that file. A patient registered at 10:00 would
  not exist at 10:01.
- Live updates (server-sent events) need a connection held open by one process.
  Serverless functions end when the response does.

The application now detects this at startup and answers with a clear 503 instead
of a raw driver error, but detecting it is all it can do.

**If you want to stay on Netlify or Vercel, the database has to move to a hosted
Postgres.** That is a real migration, not a switch — see the last section.

---

## What does work

Anything that gives you a persistent disk and a process that stays running:

| Where | What you need |
|---|---|
| **A VPS** (Hetzner, DigitalOcean, Linode, an Indian provider) | Node 22.5+, a directory for `DATA_DIR`, nginx in front for TLS |
| **Railway / Render / Fly.io** | A plan that includes a **persistent volume**, mounted and pointed at by `DATA_DIR` |
| **A hospital's own server** | The deployment most likely to satisfy an Indian hospital's data-residency questions anyway |

Check the platform's current plans yourself before committing — volume support
and pricing change, and a plan without a persistent volume fails exactly the way
Netlify does.

## Render, step by step

**You do not need Postgres on Render.** Render web services can have a
persistent disk, and a disk is all this application wants. A managed Postgres
would be an extra monthly bill attached to nothing, because no line of code in
this repository talks to Postgres. See the last section for what changing that
would actually involve.

`render.yaml` in this repository is a complete Blueprint. The whole deployment
is one web service with one disk.

### 1. Push the repository somewhere Render can see it

GitHub or GitLab. Make sure `.data/` is **not** committed — a database with demo
hospitals in it should not travel with the code, and on Render it would be
ignored anyway because the live database lives on the disk.

### 2. Create the service from the Blueprint

In the Render dashboard: **New → Blueprint**, point it at the repository, and it
reads `render.yaml`. Before the first deploy, choose a **paid instance type** —
a disk cannot be attached to a free instance, and without the disk the service
fails on its first write exactly the way Netlify does.

Everything else is already set: the disk, the mount path, `DATA_DIR`, the health
check, and a generated `STORAGE_ENCRYPTION_KEY`.

### 3. Copy the encryption key somewhere safe

Render generates `STORAGE_ENCRYPTION_KEY` once and keeps it across deploys.
Copy it into your password manager the day you deploy. Call recordings and
export bundles are encrypted with it, and if it is ever lost those files cannot
be recovered by anyone, including you. That is the point of encrypting them.

### 4. First boot

The service starts with an empty disk and creates the database. There are no
hospitals yet, so the sign-in screen says so and offers to create the first one
— that account becomes its administrator.

If you want a **demo** server instead, set `SEED_DEMO=1` in the dashboard and
redeploy. Do that only on a machine that will never hold a real patient: demo
accounts share a password.

### 5. Before anyone relies on it

Backups do not happen by themselves, and a backup nobody has restored is not a
backup. Render Cron Jobs and one-off jobs cannot access the web service’s disk. Run
`npm run backup` from the running service’s Shell, or schedule it in that same
service process environment. Copy each generation to off-service storage.
Automated off-service backups must be configured before real patient use.
See https://render.com/docs/disks and https://render.com/docs/cronjobs.

Then prove the restore works:

```bash
npm run test:disaster    # takes a backup, destroys the database, restores, verifies
```

### What Render's constraints mean here

| Constraint | Consequence |
|---|---|
| A disk attaches to **one instance only** | The service cannot scale horizontally. This app is a single process anyway — live updates and rate limiting are in-process — so nothing is lost today, but it is also the ceiling. |
| **No zero-downtime deploys** with a disk | Render stops the old instance before starting the new one. Every deploy is a short outage. Deploy at night, not during a ward round. |
| **No India region** | Singapore is the closest. For an Indian hospital asking where its patient data physically sits, the honest answer is "Singapore", and that is a conversation to have with them before signing, not after. A hospital that needs data inside India needs a VPS in India or their own server. |

---

## Running it anywhere else

The same application, started by hand — on a VPS, a hospital's own server, or
any platform with a volume.

```bash
# Node 22.5 or newer — the built-in SQLite driver arrived in 22.5
node --version

npm ci
npm run build

# A writable directory that survives restarts and deploys.
export DATA_DIR=/var/lib/hospital-ai-os

# A 32-byte key. Without it, recordings and exports are written in plain text.
export STORAGE_ENCRYPTION_KEY=$(openssl rand -hex 32)

# No demo hospitals on a server that will hold real patients.
export SEED_DEMO=0

export NODE_ENV=production
npm start
```

Then, before anyone relies on it:

```bash
npm run backup            # and put this on a schedule, off the machine
npm run test:disaster     # proves the restore actually works
```

### Environment variables that matter

| Variable | Why |
|---|---|
| `DATA_DIR` | Where the database and recordings live. **Must be on persistent storage.** |
| `STORAGE_ENCRYPTION_KEY` | 64 hex characters or 32 bytes encoded as base64. Without it, recordings and exports are plaintext on disk, and the system status page says so. |
| `SEED_DEMO` | `0` on any real deployment. `1` creates two demo hospitals whose shared password the sign-in screen prints. |
| `MFA_FLOOR` | Leave unset. `off` removes the automatic second-factor requirement for anyone who can open a patient record. |
| `ALLOW_INSECURE_COOKIES` | Only for a deliberate plain-HTTP deployment on an internal network. Never on the public internet. |

### Put TLS in front of it

The session cookie is marked `Secure` in production. Terminate TLS at nginx or
the platform's own proxy and pass `X-Forwarded-Proto`. Without it the browser
drops the cookie and nobody can stay signed in.

---

## The Postgres migration, honestly

If serverless hosting matters to you — or you need more than one machine — the
database has to become Postgres. This is the size of that job, measured rather
than guessed:

- **215 SQL statements** across **29 server modules**.
- `node:sqlite` is **synchronous**. Every Postgres driver is asynchronous, so it
  is not a matter of swapping a driver: every call site becomes `await`, and so
  does every function that contains one, all the way up.
- SQLite-specific behaviour would need replacing: `BEGIN IMMEDIATE` for the
  bed-allocation and duplicate-patient races, `PRAGMA` tuning, `VACUUM INTO` for
  hot backups, the `GLOB` pattern in the demo reset.
- In-process pub/sub (live ward updates) and in-process rate limiting both
  assume one process. Multi-node needs Redis or Postgres `LISTEN/NOTIFY` for the
  first and a shared store for the second.
- Every test suite would need to run against the new engine to mean anything.

It is a substantial, mechanical piece of work — worth doing when you need
multiple machines, and not worth doing to satisfy a hosting choice you can
change instead.

---

## The shortest path to a working demo link

Deploy to a VPS or a platform with a volume, then:

```bash
export SEED_DEMO=1        # a demo server, with synthetic patients only
export DATA_DIR=/var/lib/hospital-ai-os
npm run build && npm start
```

The sign-in screen's **"Explore the DemoCare dashboard"** button then works for
anyone who opens the link, with no password printed anywhere. Keep real patient
data off that machine — it is a demo, and its accounts share a password.
