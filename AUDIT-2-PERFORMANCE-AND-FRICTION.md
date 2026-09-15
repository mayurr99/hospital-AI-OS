# Audit 2 — the guide bot, operating friction, and behaviour under load

Everything below was measured or observed on a running build, not reasoned about.
The numbers come from `npm run test:load` against a tenant seeded to **8,046 patients,
4,040 lab orders, 16,144 vitals** — roughly a mid-sized Indian hospital's first year.

---

## 1. Why the bot was not there

**It was there in the code. It was not there on your screen.** Two separate causes, and I
hit the second one myself during this session, which is how I found it.

### 1a. The stale-server trap — the likely cause on your machine

While testing, I rebuilt the app and my changes did not appear. The reason: an older
server was still listening on the port. `next start` printed `EADDRINUSE`, exited, and
**the old process kept serving the previous build**. New code on disk, old code on screen,
no error anywhere the user can see.

This is the single most confusing state the product can be in, and nothing warned about it.

**Fixed** — `scripts/check-node.mjs` now refuses to start and explains, in `npm run dev`
and `npm start`:

- the port is already in use → prints the exact `lsof`/`taskkill` command to free it
- `src/` is newer than `.next/BUILD_ID` → tells you to rebuild before `npm start`

If the bot was missing for you, run `npm run dev` now: it will either start clean or tell
you exactly what is in the way.

### 1b. The bot was also too easy to miss, and structurally fragile

| Before | After |
|---|---|
| A white circle with a pale mascot, bottom-right, on a near-white page | A **teal "Help" pill** — a label, not decoration |
| Only one way in | Also a **Help button in the header**, and the **`?` key** from anywhere |
| Rendered *inside* the page frame | **Portalled to `<body>`** |

That last one matters beyond cosmetics. `position: fixed` is measured against the nearest
ancestor with a `transform`, `filter` or `backdrop-filter` — not the window. The shell
legitimately uses all three (the sliding sidebar, the frosted header). A guide nested
inside the page frame could be pinned to the wrong box or clipped away entirely by a style
change anywhere above it. The portal removes that risk permanently, and there is now a test
that fails if any ancestor reintroduces it.

---

## 2. Performance under load — the finding that mattered most

`GET /api/bootstrap` ran **before the first pixel of every screen**. It returned the
tenant's entire dataset: every patient, every lab order with every result, every record
kind, 300 audit rows, 200 recordings, 100 exports.

At 8,046 patients that was **3.4 MB and 5.5 seconds, on every page load**, under 24
concurrent users. Not slow — unusable. And it got worse with every patient the hospital
registered, which is exactly backwards.

### What changed

**Split the workspace payload.** `/api/bootstrap` now returns only what the chrome needs
to paint — who you are, which hospital, what you may see, and the badge counts, counted in
SQL rather than by shipping rows and calling `.filter().length` in the browser. The lists
moved to `/api/collections`, which the store fetches immediately afterwards **without
blocking the first paint**, and every collection there is bounded.

**Fixed the N+1 in lab orders.** `orderDto()` issued two queries per order inside
`listLabOrders`; listing 400 orders cost **801 round trips**. Items and results are now
fetched for the whole page in two queries — three total instead of 801.

**Fixed an O(n) lookup on the voice path.** `legacyPatientById()` loaded the entire patient
register and then called `.find()` on it. Every inbound call, every forward, every webhook.
It is now a single indexed row lookup.

**Set the SQLite pragmas that matter under contention.** `busy_timeout = 5000` was missing
entirely — a second writer arriving mid-transaction failed *immediately* with
SQLITE_BUSY. That is two nurses saving vitals in the same second, one of them seeing
"database is locked". Also `synchronous = NORMAL`, a 32 MB page cache (was 2 MB), and
memory temp storage.

### Measured, same hardware, same data

| Endpoint | Before | After | |
|---|---|---|---|
| `GET /api/bootstrap` p95 | **5,549 ms** | **104 ms** | 53× faster |
| `GET /api/bootstrap` payload | **3,409 KB** | **16 KB** | 213× smaller |
| `GET /api/lab/orders` p95 | 666 ms | 299 ms | 2.2× faster |
| `GET /api/patients/:id` p95 | 108 ms | 72 ms | |
| `POST vitals` × 24 concurrent | 83 ms p95 | 69 ms p95 | 0 lock errors |
| 24 staff claiming one bed | 1 won, 23 refused | 1 won, 23 refused | still correct |

`/api/collections` is now the slowest at 712 ms p95 / 518 KB — but it is **off the critical
path**: the workspace is drawn and usable while it loads. Reducing it further means paging
the remaining screens the way the patient list now works; that is listed as remaining work
below, not claimed as done.

`npm run test:load` reproduces all of this.

---

## 3. Operating friction

I audited every screen for controls that report success without doing anything. Your
original brief said *"Do not create buttons that do nothing"* — these were violations of it,
and some were mine.

### Controls that lied — fixed

| Where | What it did | What it does now |
|---|---|---|
| **Hospital switcher** (sidebar) | Picking a hospital pushed you to `/platform` and never switched — including picking the one you were already in | Actually switches tenant via `setActiveOrg` |
| **Telephony settings** (whole card) | Every input was uncontrolled (`defaultValue`, no `onChange`); Save only raised a toast. **Nothing an administrator typed was ever stored** | A real controlled form; Save enables only when something changed; verified to survive a reload by test |
| **New campaign** | A full multi-field form whose Create button only raised a toast — the campaign never existed | Creates the record; verified persistent across reload by test |
| **Campaign cohort estimate** | Printed a hardcoded `60` regardless of selection, and a cost figure derived from it | Counts patients actually matching the department and consent rule |
| **Call quality table** | "Interruptions", "ASR confidence" and "Audio" computed from the **row index**, presented as sampled telemetry | Invented columns removed; shows what the platform actually records, and says per-call audio quality needs the provider API |
| **Pharmacy "Raise purchase order"** | Said a PO was raised while silently **adding the quantity to stock** — recording goods as received before anyone ordered them | Relabelled "Record stock received", which is what it does; says plainly that POs are not managed here |
| **Live call: Mute / Take over / Whisper** | Toasts only. Staff could believe the patient could not hear them, or that they were on the line | Disabled on live provider calls with the reason; on the simulator they work and are written into the saved transcript |

### Friction removed

- **Search covered 300 patients, silently.** The list cached a working set and filtered it in
  the browser, so in an 8,000-patient hospital most patients were unfindable. Search now goes
  to the database across the whole register, with the true count shown, and the footer says
  what is on screen versus what exists.
- **The live console could not call patient #41.** A plain dropdown capped at 40 with no
  search. Now filters the whole loaded register as you type.
- **Dialogs had one way out.** Escape, backdrop click and autofocus on the first field now
  work on every modal in the app, and the page behind stops scrolling.
- **Filters reset constantly.** Filtering the patient list, opening a patient and pressing
  back discarded the filter every time. Filters on patients, calls, billing, care queue,
  escalations, pharmacy and admissions now survive navigation for the working session.
- **Queues claimed to be clear before they had loaded.** Escalations said "Nothing here",
  Emergency said "Department is clear", the care queue said "Queue is clear" — while the data
  was still in flight. All now show a loading state; there is a test that holds the request
  open and fails if any of them says "clear" too early.
- **No keyboard path to search.** `/` or Ctrl/Cmd-K focuses the global search from anywhere;
  Escape clears it. `?` opens the guide.
- **Design-system gaps** that caused friction everywhere: `Field` had no required marker and
  no error slot (so disabled Save buttons never explained what they were waiting for);
  `EmptyState` had no action slot, making all ~45 empty states dead ends. Both now exist.

---

## 4. Tests

| Suite | Checks | |
|---|---|---|
| `tests/suite.mjs` | 189 | SaaS lifecycle, CRUD, tenant isolation, RBAC, voice, exports |
| `tests/clinical.mjs` | 137 | 32-step clinical scenario, bed race, IDOR |
| `tests/ui.mjs` | 77 | Browser CRUD, settings round-trips, mobile |
| `tests/clinical-ui.mjs` | 37 | Clinical screens, role restrictions, the guide |
| **`tests/ux.mjs`** | **27** | **New** — one check per defect above |
| **Total** | **467** | **0 failing** |

`tests/ux.mjs` is deliberately written so each check fails if the specific defect returns:
the guide leaving `<body>`, a modal that ignores Escape, a search that misses a patient
outside the cached slice, a filter that resets, a settings form that does not persist, a
campaign that is not created, a queue that says "clear" too early.

`tests/load.mjs` is a diagnostic, not a benchmark — run it after any change to a list
endpoint.

---

## 5. What I have NOT fixed — stated plainly

The screen-by-screen audit found more than I could responsibly fix and verify in one pass.
These are real, I have evidence for each, and none of them are done:

**Controls that still do nothing:**

- `/portal` — six patient-facing buttons (Reschedule, Cancel, Get directions, Ask for a
  callback, View report, Pay now) are all toasts. "Cancel" claims a cancellation was
  requested while the appointment is untouched.
- `/billing` — "Send payment link" sends nothing.
- `/calls` — "Play recording" plays nothing, though a working player exists on `/recordings`.
- `/admin/integrations` — "Sync now" and "Reconcile queued events" change nothing.
- `/settings/plan` — "Choose a plan" is the dead end at the bottom of the trial-expiry flow.
- `/admin/org` — the Add modal is still fake (uncontrolled inputs, no write). I reported this
  to you earlier and it is still not built.
- `/data` — the date-range and department filters are decorative, and four of six export
  templates download the same analytics series under a misleading filename. Use `/exports`,
  which is the governed pipeline.

**Missing confirmations on consequential actions:** discarding a completed call, cancelling
an appointment, pausing a published production agent, closing a critical queue item, and the
patient consent toggles (which fire on change with no undo — withdrawing clinical-call
consent blocks all future follow-up calls).

**A clinical-data bug I have not yet fixed:** the patient profile shares one `form` state
across nine modals and never clears it. Open "Record vitals", type, cancel, then open
"Prescribe" — the stale vitals keys are still in `form` and get spread into the prescription
request. This should be fixed before anyone uses that screen on a real patient.

**Still not built at all:** OT scheduling/cancel/emergency update, pharmacy dispensing, the
real doctor/department/branch form.

**Still silently truncated without saying so:** appointments (6 providers, 18 slots),
admissions admit-dropdown (300), users permission matrix (12), care queue (40), billing (40),
calls (50). Only the patient list currently tells you what it is showing versus what exists;
`ShowingCount` now exists in the design system to fix the rest.

---

**This is not production ready.** The workflows I tested are tested, and the numbers above
are real. The list in section 5 is what stands between this and a hospital using it.
