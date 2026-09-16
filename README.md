# Hospital AI OS

**Multi-tenant hospital operating system — one patient record, many visits.**

Hospital → Patient → Visit / Encounter / Admission → Clinical records · Laboratory · Medication ·
Ward / Bed · Billing · Communication · Discharge — with AI voice follow-up on top, not in place of it.

Any hospital can register, get a 7-day free trial, answer a setup questionnaire, choose which modules to
unlock, point recordings at their own disk or S3 bucket, connect their own Retell and ElevenLabs accounts,
and land on a dashboard already configured for them — with everything enforced server-side and audited.

---

## Run it

```bash
npm install
npm run dev            # http://localhost:3000
```

Production:

```bash
npm run build && npm start
```

**Node 22.5 or newer** — the data layer uses Node's built-in SQLite (`node:sqlite`), which does not exist in
Node 20. `npm run dev` checks this first and tells you plainly if the version is too old. No database server, no
API keys, no external services required to boot. The database and local recordings are created under
`./.data` on first run; `npm run db:reset` wipes and reseeds.

---

## Two ways in

**Start a trial** — open `/signup`, register your hospital, and you are taken through setup.

**Look around first** — open `/login` and pick any demo account. Password for all of them is `demo1234`.

| Account | Role | What they see |
|---|---|---|
| `mayur@hospitalai.os` | Platform super admin | Tenant console only — **no access to patient clinical data** |
| `sunita.kale@democare.in` | Hospital admin | Everything in DemoCare, including all configuration |
| `a.deshmukh@democare.in` | Doctor | Encounters, diagnoses, prescribing, lab ordering, admissions |
| `r.tambe@democare.in` | Nurse / coordinator | Care queue, live console, vitals, admissions, sample collection |
| `g.more@democare.in` | Reception | Register, book, import — no clinical view, no prescribing |
| `f.khan@democare.in` | Billing | Invoices only — blocked from the ward board |
| `rajesh.patil@example.com` | Patient | The patient self-service portal |
| `nitin.wagh@sahyadricity.in` | Hospital admin | A second, separate tenant |
| `s.dhumal@democare.in` | Lab technician | Sample collection, result entry and verification |
| `o.bhide@democare.in` | Suspended | Cannot sign in — lifecycle control demonstrated |

Three hospitals are preloaded with synthetic patients, calls, escalations and recordings so nothing is empty.

---

## The SaaS lifecycle

1. **Register** — hospital name, admin, password. A tenant, a hospital-admin user and a 7-day trial
   subscription (10 seats, 500 voice minutes) are created in one transaction.
2. **Setup questionnaire** — nine steps: what you want to fix first, hospital profile and branches,
   departments, doctors with slot length and fee, languages and call volume, **which modules to unlock**,
   **where recordings should live**, **which voice provider and which main line for critical calls**, then
   review. Progress is saved on every step, so a half-finished setup survives a refresh.
3. **Provisioning** — facilities, departments, doctor calendars, wards and beds, a starter clinical protocol
   (as a *draft*, awaiting your clinical sign-off) and your AI agents (also drafts) are created. Nothing calls
   a patient until a human publishes an agent.
4. **Ready dashboard** — configured for your hospital, with a trial banner counting down.
5. **Trial ends** — nothing is deleted. The workspace stays readable; patient calling is blocked until a plan
   is active. Enforced server-side, not by hiding a button.

Modules you did not unlock never appear in the sidebar, and their pages refuse to render. Change them any
time in **Plan & usage**.

---

## Storage: local or your own cloud

**Settings → Storage & retention.**

- **Local volume** — audio stays on the server running the platform, under a per-tenant folder.
- **S3-compatible** — your own AWS S3, Cloudflare R2, MinIO or Wasabi bucket, with one-click presets.

**Test connection** performs a real write, read-back and delete and reports exactly what happened. Audio,
transcripts and clinical summaries carry separate retention periods — a summary stays useful for years,
raw audio rarely needs to.

Recordings are written only when that patient's recording consent is granted, are streamed through the
server (never linked from the bucket), and every playback writes an audit event.

---

## Voice: Retell and ElevenLabs, or the built-in simulator

**Settings → Voice providers.**

- **Retell** — API key, agent picker (loaded live from your account), outbound caller ID, webhook secret, and
  the webhook URL to paste into Retell. Used for outbound calls, inbound answering and live warm transfer.
- **ElevenLabs** — API key, voice library loaded from your account, model, stability and similarity, and an
  instant **Preview the voice** button.
- **Simulator** — full conversation, transcript, red-flag detection, recording and escalation generated
  locally with no vendor and no spend. This is what a new tenant gets by default.

Both providers have a live **Test connection** that reports the real result. API keys are stored server-side
and returned to the browser masked; re-saving a masked value keeps the stored secret. A failed live call is
reported as a failure and is never silently converted into a simulated call.

Everything the platform needs from a voice vendor sits behind one interface (`src/lib/server/voice.ts`), so
adding a fourth provider is a single file and no screen changes.

---

## Critical situations forward to the main line

**Settings → Escalation routing.** Configure the main line, an after-hours number, a fallback, the on-call
rota, transfer mode (warm / cold / conference), alert channels and the acknowledgement SLA.

When a follow-up call hits a red flag:

1. The **deterministic protocol engine** matches it — the language model never decides urgency.
2. The routine questionnaire stops immediately; no advice, no improvisation.
3. The **live call is handed to your main line** (after-hours number outside 08:00–20:00), with the fallback
   number tried if the first does not accept.
4. An **escalation opens with the SLA clock running**, assigned and acknowledged by a named person.
5. **Nothing is ever dropped** — if no line answers, a high-priority callback task is raised for a human.

Every step is reported back into the live console and written to the audit trail. If no main line is
configured, the platform refuses to start a protocol call rather than risk a red flag with nowhere to go.

Watch it: sign in as the nurse, open **Live call console**, pick a patient marked `(red)`, and press
**Start AI call**.

---

## Exports

**Export centre.** Seven templates. Your role decides the columns — asking for clinical free text without
the permission returns `[restricted]`, not an error you can work around. Files are written to *your* storage,
handed over on a **single-use link that expires in an hour**, and audited twice: once when generated, once
when collected.

---

## Testing

Four suites. Start the app first (`npm start` on port 3100, or set `BASE`).

```bash
npm run test:api          # 189 checks — SaaS lifecycle, CRUD, isolation, voice, exports
npm run test:clinical     # 137 checks — the 32-step clinical scenario across two hospitals
npm run test:ui           # 77 checks  — browser; needs: npm i -D playwright
npm run test:ui:clinical  # 31 checks  — browser; import wizard, profile, ward board, lab bench
npm test                  # all four
```

**Latest run: 434 passed, 0 failed** from a clean database, with no server-side errors logged.

`test:clinical` walks the whole journey: create two hospitals, staff them with four roles, download the
template, upload a legacy spreadsheet with foreign headings, verify automatic mapping, see row-level
validation errors, detect duplicates, import, open the profile, admit, assign a bed, race two staff for
the same bed, record vitals, write and amend an encounter, diagnose, prescribe (including an allergy
warning and an override), order a lab, collect, result, verify, amend with a reason, transfer, discharge,
and then attempt ten different cross-tenant reads and writes from the second hospital — all refused.

`test:api` covers: public pages · signup, duplicate/weak-password rejection, 7-day trial · onboarding save,
resume and provisioning · **create / read / update / delete / list on all 12 record types** · persistence
across new sessions · **multi-tenant isolation** (cross-tenant read, update, delete and download all refused)
· user invite, suspend (revoking live sessions), remove · permission enforcement per role · storage config and
a real connection test · voice config, masked secrets, provider tests, TTS preview · calling, the consent
gate, **critical forwarding**, recordings, minute metering · governed exports with token, masking and expiry ·
14 audited event types · the platform console · demo tenants · logout.

`test:ui` drives a real browser through: the public pages · **signup → nine-step wizard → ready dashboard** ·
**all 32 screens** · role-scoped access for six roles · **a live call with a red flag forwarded to the main
line**, then the recording and escalation that result · settings round-trips including a storage test and a
voice preview · **UI CRUD** (invite a user, book an appointment through the slot-lock flow, toggle consent,
generate an export) · mobile layout at 390px.

Bugs this suite caught and that are now fixed: the session cookie being marked `secure` over plain HTTP
(silently dropping sessions on a hospital's internal server), the client store not refreshing after signup so
a freshly authenticated user could be bounced to the login page, the user-invite path issuing a PATCH to a
non-existent user, a crash on the telephony page, and a grid child that could not shrink on mobile.

---

## The clinical core

The patient is the central entity: **one permanent identity per hospital**, with many visits,
admissions, ward movements, orders, results and prescriptions hanging off it. Nothing clinical is stored
on the patient row — no current ward, no current medication list, no last blood pressure. Those are
separate historical records, and a new entry is always created rather than an old one overwritten.

| Entity | Table | What it guarantees |
|---|---|---|
| Patient | `patients` | UHID unique per hospital; age derived from DOB, never stored as truth |
| Allergy | `patient_allergies` | Structured substance / reaction / severity; retired, never deleted |
| Encounter | `encounters` + `encounter_versions` | Amending a note snapshots the previous version |
| Admission | `admissions` | **One active admission per patient**, enforced by a partial unique index |
| Ward movement | `ward_assignments` | **One active assignment per bed**, enforced by the database |
| Bed | `wards` / `rooms` / `beds` | `AVAILABLE · OCCUPIED · RESERVED · CLEANING · MAINTENANCE · BLOCKED` |
| Vitals | `vitals` | A time series with plausibility bounds, not columns on the patient |
| Diagnosis | `diagnoses` | Coded or free text, `active / resolved / entered_in_error` |
| Medication | `medication_orders` | Structured dose, route, frequency, duration — with an allergy check |
| Laboratory | `lab_tests` / `lab_analytes` / `lab_orders` / `lab_order_items` / `lab_results` | A workflow with machine-readable flags |
| Critical result | `critical_notifications` | detected → notified → acknowledged, by a named person |
| Timeline | `patient_events` | Every event, linked to the record that produced it |
| Audit | `clinical_audit` | Actor, entity, action, reason, before and after |
| Import | `import_batches` / `import_rows` / `import_mappings` | Preview, per-row outcome, remembered column mapping |

A bed is never assigned twice, because the database will not allow it:

```sql
CREATE UNIQUE INDEX ward_assign_one_active_bed
  ON ward_assignments (org_id, bed_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX admissions_one_active
  ON admissions (org_id, patient_id) WHERE status = 'ACTIVE';
```

Two receptionists clicking the same free bed at the same instant is covered by a test: exactly one
succeeds, the other gets a 409, and the bed ends with exactly one occupant.

---

## The laboratory is a workflow, not a form

```
ORDERED → SAMPLE_COLLECTED → PROCESSING → RESULT_ENTERED → VERIFIED → RELEASED
```

A step cannot be skipped and nothing moves backwards. Results are stored per analyte with the
reference band and a derived flag (`NORMAL · LOW · HIGH · CRITICAL_LOW · CRITICAL_HIGH`), so "high" is a
stored value rather than a colour in the interface. A critical value opens a tracked notification that a
named clinician must acknowledge — **no automated system interprets or acts on it**.

A verified result cannot be edited quietly: changing it requires a reason, creates an `AMENDED` version
and keeps the previous one.

---

## Bulk patient import

**Patients → Import patients.** Your own spreadsheet, with your own column headings.

Download the two-sheet template (`PATIENTS`, `ADMISSIONS`) or just upload what you already have.
Headings are matched on a normalised form, so `Phone`, `Phone No.`, `Contact Number` and `Mobile` all
resolve to the same field; anything unrecognised is shown for you to map by hand, and **the mapping is
remembered per hospital** for next time.

Nothing is written until you approve the preview. You get total / valid / invalid / duplicate counts,
row-level errors (*row 38 — invalid mobile number*, *row 72 — DOB is in the future*), possible duplicate
matches against your existing patients, conflicting values side by side, and a per-row choice of
**create / use existing / update / skip**. Commit runs row by row in its own transaction, so one bad row
fails that row and is reported rather than corrupting the batch. An error report downloads as CSV.

Duplicate matching is tenant-scoped and never crosses hospitals: the same person legitimately exists as
two separate identities in two hospitals. Clinical history is never overwritten by a spreadsheet.

---

## Architecture

```
src/
  app/
    page.tsx                 marketing + pricing
    signup/ login/           registration and sign-in
    onboarding/              the nine-step hospital setup wizard
    (app)/                   authenticated workspace — one folder per module
    api/                     every server route
      auth/                  signup, login, logout, me, switch-org
      bootstrap/             one tenant-scoped payload for the whole workspace
      onboarding/            save progress, provision
      records/[kind]/[id]    generic tenant-safe CRUD for 12 entity types
      users/                 invite, update, suspend, remove
      settings/[key], test, features
      voice/                 call, forward, voices, preview, webhook/retell
      recordings/, exports/, audit/, platform/tenants
  components/
    AppShell.tsx             sidebar, tenant switcher, trial banner, feature gating
    ui.tsx                   the design system
  lib/
    server/
      db.ts                  SQLite, schema, tenant-scoped repository, audit
      auth.ts                scrypt passwords, sessions, requireOrg choke point
      provision.ts           tenant creation, trials, provisioning, features
      storage.ts             local + S3 drivers behind one interface
      voice.ts               Retell + ElevenLabs + simulator behind one interface
      kinds.ts, exports.ts, route.ts
    types.ts, rbac.ts, store.tsx, nav.ts, seed.ts, utils.ts
tests/
  suite.mjs                  API + lifecycle suite
  ui.mjs                     browser suite
```

Next.js 15 (App Router) · TypeScript · Tailwind v4 · Recharts · lucide-react · Node built-in SQLite.

**Why not Prisma:** the build environment blocks Prisma's engine binary download, so wiring an ORM that
could not be tested would have been worse than raw SQL that is. All database access goes through
`src/lib/server/db.ts` — swapping in Prisma, Drizzle or `pg` means reimplementing `all / get / run` and the
`records` repository against Postgres, and nothing above that layer changes.

### How tenant isolation actually works

Every data route calls `requireOrg()`, which derives the tenant **from the session on the server** and never
from the request body. There is no endpoint that accepts an organisation id from the client, and none that
can return two hospitals' records. The test suite proves this by attempting cross-tenant reads, updates,
deletes, recording fetches and export downloads — all refused.

---

## From here to production

| Layer | Today | Next step |
|---|---|---|
| Database | SQLite via `node:sqlite` | Postgres behind the same `db.ts` surface; the `records` table becomes real tables where you need joins |
| Auth | scrypt + DB sessions | Add OIDC/SAML for hospital SSO; real TOTP for the MFA step |
| Voice | Retell + ElevenLabs adapters, simulator fallback | Point the webhook at a public URL; add SIP trunking for inbound |
| Billing | Plan, seats and minutes enforced server-side | Wire Razorpay or Stripe to the subscription row |
| Protocols | Versioned, approved, deterministic | Unchanged — this is already the production design |
| Storage | Local + S3 drivers | Unchanged — point at your bucket |
| Audit | Append-only table | Ship to the hospital's SIEM |

---

## Notes

- Every patient, doctor, call, recording and invoice in the demo tenants is synthetic.
- The simulator is a deterministic stand-in for the voice pipeline. It demonstrates the *governance* model —
  identity verification, purpose-limited context, tool allow-list, protocol evaluation, escalation,
  provenance — rather than calling a model. Connect Retell and ElevenLabs for real calls.
- Clinical content is illustrative. A real deployment needs the hospital's own clinical governance review,
  privacy review, telecom classification review and security architecture review before any patient is called.
