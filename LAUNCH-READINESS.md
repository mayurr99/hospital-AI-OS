# Launch readiness — flaws, distance to live, and what could go wrong

Written after auditing the running build, not from memory. Everything marked
**verified** was reproduced against the app; everything else is marked as
judgement or as something needing professional advice.

I am not a lawyer and not a regulatory consultant. The legal section below is
the shape of the questions you need answered by someone who is, before a real
patient's record goes into this.

---

## Part 1 — What I found today, and fixed

I audited the perimeter before answering, because the honest answer to "how far
are we" depends on what is actually there. Six issues would each, on their own,
have led to a full patient-data breach on day one. All six are **verified** —
reproduced with real requests — and now fixed and re-verified.

### The worst one was mine

`/api/collections` — the endpoint I created two sessions ago when splitting the
workspace payload for performance — checked only that you had *a session in some
hospital*. It did not check what you were allowed to see.

Reproduced: signing in as the **patient portal account**, whose only permission
is to see its own record, returned **300 other patients, 64 call transcripts and
200 audit-log rows**.

I introduced that while making the product fast. Being inside a tenant is not
authorisation, and a bulk endpoint has to enforce exactly what the per-record
endpoints enforce or it becomes the way around them. It now filters every
collection by the caller's own permissions — verified: that same account now
gets `403`, and reception gets patients with diagnoses and allergies stripped,
calls with transcripts removed, and no audit trail at all.

### The other five

| | What it was | Verified fix |
|---|---|---|
| **Platform super-admin with a published password** | `mayur@hospitalai.os` / `demo1234` → super_admin over *every* hospital. Seeded into any empty database with no environment check, and the password printed on the public login page. | Demo seeding is now opt-in (`SEED_DEMO=1`), off by default in production; the login screen asks the server whether demo tenants exist and shows nothing if they don't |
| **Tenant API keys served to every user** | `/api/bootstrap` shipped each hospital's Retell key, webhook secret and S3 credentials to every signed-in browser — including the patient portal | Redaction moved to one shared module used by both paths. Verified: set a real key, then confirmed it appears in **no** response |
| **No rate limiting anywhere** | Unlimited password guesses. Worse: password hashing is deliberately slow and runs on one event loop, so a few hundred concurrent logins would stall the entire hospital's software | Per-account and per-address limits, counted *before* the expensive check. Verified: 8 failures then `429` |
| **Webhook failed open** | The voice webhook accepted unsigned requests when no secret was configured — which is the state every tenant starts in. Anyone could post a fabricated transcript into a patient's chart | Fails closed |
| **No security headers** | No CSP, HSTS, framing or referrer policy. Patient ids in URLs leaked to any third-party asset | All added |

Also fixed while in there: sessions cut from 30 days to 7 and now invalidated
when a password changes (previously an admin resetting a compromised account
achieved nothing — the attacker's cookie kept working); scrypt cost raised to the
OWASP floor; cookies default to `Secure` in production instead of inferring it
from a header nginx doesn't send unless told to.

### Two real bugs found by the fixing

**Patient search returned the wrong patient.** Searching a name containing four
or more digits also matched every patient whose *phone number* contained those
digits. A receptionist looking up one person was shown a stranger's record beside
theirs, unexplained. That is how the wrong chart gets opened. Now a phone search
is one where the digits are essentially the whole query.

**A settings blob missing one field white-screened the page.** The voice settings
screen read `cfg.elevenlabs.stability.toFixed(2)`; a tenant configured before
that field existed got "Application error" and could not reach their settings at
all. Stored JSON always outlives the code that wrote it, so settings are now
completed against defaults on read.

### And one I nearly shipped

My first Content-Security-Policy **took the whole product down** — Next.js
hydrates through inline scripts and my policy banned them; the sign-up form
rendered zero inputs. The textbook fix (per-request nonces) then blocked every
JavaScript chunk, because nonces only apply to dynamically rendered routes and
this app is statically prerendered.

The shipped policy uses `'unsafe-inline'` for scripts, and I want that stated
plainly rather than buried: **it does not stop an injected inline script.** What
it does still buy is real — nothing loads from another origin, nothing frames the
app, and `connect-src 'self'` means an injection cannot ship a patient list to an
attacker's server, which is the step that turns a bug into a breach. A genuinely
strict policy means making the workspace routes dynamic. It's on the list below.

**Tests: 510 passing, 0 failing** across six suites.

---

## Part 2 — What is still wrong

### Blocking — do not launch with these

**1. There is no durability story.** This is the biggest risk in the project,
larger than any security finding, because a breach is survivable and a lost
database is not. One SQLite file, one machine, no replication. I added
`npm run backup` today (consistent snapshot via `VACUUM INTO`, integrity-checked,
rotated — verified working: 13.7 MB, 8,231 patients). That is a start, not a
system. You still need: backups running on a schedule, shipped **off the
machine**, and — the part everyone skips — **a restore you have actually
performed**. An untested backup is a hope.

**2. One node, no failover.** If the process dies, the hospital has no system.
Not "degraded" — no patient list, no ward board, no lab. A hospital cannot stop
because your server rebooted. You need at minimum a supervised process that
restarts, health checks, and a documented manual failover. Note that live updates
and rate limiting are currently in-process, so multi-node needs Redis (or
Postgres LISTEN/NOTIFY) first.

**3. No monitoring.** Right now you would learn about an outage from a phone
call. You need uptime checks, error tracking, and an alert when the disk fills —
SQLite's failure mode when the disk is full is writes failing, which in this app
means a nurse's vitals silently not saving.

**4. MFA is decorative.** ~~It is stored, displayed and toggleable, and
**nothing challenges for it at sign-in**.~~ **Fixed — see "What has changed
since" below.** Sign-in now issues a challenge rather than a session, TOTP is
verified server-side, codes cannot be replayed, and an account that owes a
factor and has none is made to enrol before anything opens. A password reset
flow exists alongside it. 53 API checks and 20 browser checks cover it.

**5. `encryptAtRest` is a toggle that does nothing.** It defaults to on, appears
as a switch in Settings, and no code reads it. The database and recordings are
plaintext on disk. A hospital ticking that box gets a false compliance assurance,
which is worse than not offering it.

**6. Controls that still do nothing.** Unchanged from the previous audit: six
patient-facing buttons on `/portal`, "Send payment link", "Play recording",
integration sync, "Choose a plan", and the `/admin/org` Add modal.

**7. The patient profile shares one form state across nine modals** and doesn't
clear it on cancel — cancelled vitals can ride along with the next prescription.
This one is clinical and I'd fix it before anyone uses that screen on a real
person.

### Important, not blocking

- No password reset flow at all. A user who suspects compromise has no recourse.
- Optimistic concurrency covers patient demographics only — not encounters,
  medications or diagnoses.
- Retention is configurable and never enforced; no purge job exists.
- Authenticated SSRF: the S3 endpoint field is passed straight to the client, so
  any trial signup can probe your internal network.
- Record ids use `Math.random()`, not a CSPRNG.
- No structured logging, no request ids, no way to trace an incident.
- The reference ranges and prices in the lab catalogue are **illustrative**. They
  are method- and instrument-specific in every real laboratory. The mechanism is
  right; the numbers must be replaced and signed off by the hospital's own lab.

---

## Part 3 — How far from live

There is no single number, because it depends on who you launch *to*. Three
honestly different distances:

### A. One friendly pilot hospital, non-clinical use first — ~3–5 weeks
Front desk, appointments, patient registry, AI follow-up calls. **No clinical
decision-making, laboratory used for recording only, running alongside whatever
they use today rather than replacing it.**

Needed: backups + a tested restore, monitoring, MFA for admins, a password reset
flow, real encryption at rest, remove or finish the dead buttons, a signed data
processing agreement, and the lab ranges either configured by their lab or the
module switched off.

### B. That pilot doing real clinical work — ~2–4 months
Laboratory results reaching charts, medication and allergy checking, discharge.
Everything in A, plus: the clinical form-state bug, concurrency on all clinical
writes, retention enforcement, an audited clinical validation by their own
clinicians, and a regulatory answer on Part 4 before a single result is released
from this system.

### C. Public multi-tenant SaaS, self-serve signup — ~6–12 months
Everything above, plus Postgres and multi-node, SOC 2-style controls, a real
incident response plan, penetration testing by someone who is not me, 24/7
on-call, and the legal work done rather than deferred.

These are engineering estimates for a small competent team and assume nothing
goes wrong, which it will. **Treat them as the optimistic end.**

---

## Part 4 — Risks and consequences

### The one that matters most

This software **flags critical laboratory values, computes eGFR, and warns on
medication–allergy interactions**. In many jurisdictions that makes it *Software
as a Medical Device*, not a hospital admin tool — a completely different
regulatory category with registration, clinical validation and post-market
surveillance obligations.

In India, CDSCO regulates certain software as a medical device. **You need a
regulatory consultant to tell you whether this qualifies, before it is used
clinically.** Getting this wrong is not a fine-and-move-on situation; it can mean
the product cannot be sold and that liability for a bad outcome sits with you.

The cheapest way to de-risk it commercially is to launch *without* the
interpretive features — record results, don't flag them; don't compute derived
values — and add them once you have an answer. That is a real product decision
and worth taking seriously.

### Legal and regulatory — get advice on each

- **DPDP Act 2023 (India)** — health data is sensitive personal data. Consent,
  purpose limitation, breach notification, a Data Protection Officer above a
  threshold, and rights of erasure your product currently cannot honour.
- **Breach notification.** If patient data leaks you are likely legally required
  to tell the regulator and the affected people, within a deadline. You currently
  have no way to determine *what* leaked — session and audit IP capture was only
  added today — which makes a notification both harder and more damning.
- **ABDM / ABHA.** The product displays ABHA ids. Anything claiming ABDM
  integration has a certification process.
- **Call recording consent.** Recording a patient without clear consent has its
  own exposure, separate from data protection. The consent engine exists; the
  legal wording needs review.
- **TRAI / DLT registration** for outbound automated voice in India.
- **Medical record retention.** Hospitals are typically required to retain
  records for years. Your retention settings are not enforced *and* you have no
  proven restore — you can currently fail this obligation in both directions.

### Operational consequences, concretely

| If this happens | What it looks like |
|---|---|
| The server dies mid-shift | A hospital with no patient list, no ward board, no lab results. Staff revert to paper with no handover |
| The disk fills | Writes fail silently. A nurse records vitals that were never saved |
| The database corrupts with no tested restore | Permanent loss of a hospital's records. Commercially and possibly legally terminal |
| A breach | Notification duty, contract termination, and every other prospect asking a question you cannot yet answer |
| A wrong result reaches a chart | The one that actually hurts someone. This is why the lab ranges must be signed off by a real laboratory |

### Business risks worth naming

- **You have no customers yet**, so every claim in the product is untested
  against real use. Expect the first pilot to find things no test suite would.
- **Support burden.** Hospitals run 24/7; a 9-to-5 founder cannot support a
  system that nurses depend on at 3am. Set that expectation in the contract.
- **Concentration risk.** One pilot hospital that leaves takes 100% of revenue.
- **Insurance.** Professional indemnity and cyber liability cover, sized for a
  health-data breach, before the first real patient — not after.

---

## Part 5 — What I would do in order

1. Backups off the machine, on a schedule, **with a restore you have performed**
2. Monitoring and alerting, including disk
3. Get the regulatory question answered — it may change what you launch
4. ~~MFA for anyone who can see patient data, plus a password reset flow~~ —
   **done**, with the limits listed below
5. Real encryption at rest, or remove the toggle
6. Fix or remove every control that does nothing
7. Fix the patient-profile form-state bug before clinical use
8. Have the pilot hospital's own laboratory sign off the reference ranges
9. Independent penetration test
10. Then pilot — narrow, supervised, alongside their existing system


---

## Addendum — two-step sign-in and password recovery

Item 4 above is done. What that means precisely, because "we have MFA" is the
kind of claim this document exists to stop anyone making loosely.

**What is in force.** A sign-in that passes the password no longer produces a
session if the account owes a second factor. It produces a *challenge*: a row in
its own table, carrying no cookie and opening nothing. The challenge can only be
exchanged for a session by producing a code. That distinction is what the tests
check — not "is a prompt shown" but "can this half-finished sign-in read the
patient register", which it cannot.

- TOTP to RFC 6238, verified against an independent implementation in the test
  suite rather than against the app's own code, so a drift from the standard
  fails the build instead of passing quietly.
- A code works **once**: the time step it belonged to is recorded and refused
  afterwards. Five wrong codes destroy the challenge.
- Ten backup codes, stored only as scrypt hashes, each usable once, shown
  exactly once with the screen saying so.
- Required by default of **anyone who can open a patient record**. A hospital
  administrator can widen that; they cannot narrow it from a settings screen.
- An account that is required but not yet enrolled is made to enrol *during*
  sign-in, before any session exists.
- Adding, removing or resetting a factor, and any password change or reset, ends
  every other session for that account.

**What is exempt, stated plainly.** Demo hospitals and, while demo data is
present in the database, the platform account. Their data is synthetic and their
password is printed on the sign-in screen, so a factor there protects nothing. A
production deployment runs with `SEED_DEMO=0` and has neither. The system status
screen reports which kind of database this is, so it is checkable rather than
taken on trust. A server operator can also lower the automatic requirement with
`MFA_FLOOR=off`; that too is reported on the status screen when set.

**Password recovery.** "Forgotten your password" answers identically whether or
not the address exists, and it does **not** claim to have sent an email, because
this deployment sends none. The request is recorded for the hospital's
administrators, who issue a one-hour, single-use link from the staff screen and
hand it over having checked who they are talking to. Resetting enforces the same
password rules as sign-up, ends every session, and does **not** skip the second
factor.

**What is still missing, and should be said to any hospital that asks:**

- **No email transport.** Until there is one, self-service reset depends on an
  administrator being reachable. That is a real operational constraint, not a
  design preference.
- **No re-authentication for sensitive actions.** A signed-in session can export
  patient data or change settings without presenting the factor again.
- **No WebAuthn / hardware keys**, and no push approval. TOTP only.
- **No device trust or session listing.** A user cannot see where they are
  signed in and end one session in particular; the choices are all or nothing.
- **Backup codes are the only recovery path** besides an administrator. Lose the
  phone and the codes, and an administrator must reset the account.

---

**Bottom line.** The clinical architecture is sound and genuinely well tested;
that is the hard part and it is largely done. What stands between here and live
is not clever engineering — it is durability, operations, and the legal work.
Those are unglamorous and they are what a hospital will actually judge you on.

**Do not put a real patient's record in this until at least items 1–3 are done.**
