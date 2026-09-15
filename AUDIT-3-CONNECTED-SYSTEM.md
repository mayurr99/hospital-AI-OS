# Audit 3 — how laboratory, ward, patient and billing are connected

Your questions, answered by what the software now does. Every claim below has a
test behind it in `tests/connected.mjs` (41 checks), and the numbers come from a
tenant holding **8,048 patients, 4,052 lab orders, 16,000 vitals**.

---

## 1. What was actually connected before, and what wasn't

The clinical core was already relational — a lab order belonged to a patient and
could belong to an encounter or an admission. Three things were missing, and I
found them by inspection rather than assuming:

| | Before | Now |
|---|---|---|
| **Live updates** | Nothing. No stream, no polling. Two nurses on the same ward board never saw each other's work until one reloaded. | Server-sent events, per hospital, resolved from the session |
| **Overwrite protection** | `patients.version` existed and was **never checked**. Last write silently won. | Field-level optimistic concurrency, refused with both values shown |
| **Billing** | A JSON blob typed separately from the chart | Derived from the clinical events that justify it |

---

## 2. Real-time — how data updates without a reload

`GET /api/stream` holds an SSE connection per signed-in user. Two design
decisions matter more than the mechanism:

**The stream carries no patient data.** An event says only *what kind of thing
changed* and *which record* — never a name, a value or a diagnosis. Screens
refetch through the normal endpoints, which apply the permission rules. A stream
that carried the data would have to re-derive every role rule, and the first
mistake there is a PHI leak. This way it is structurally incapable of leaking.
There is a test that fails if any event payload ever contains a name or a value.

**Subscriptions come from the session, never the request.** A test signs in to a
second hospital, watches the stream while the first hospital is busy, and asserts
it receives exactly zero events.

Events are published from `clinicalAudit()`, which every one of the 31 clinical
writes already calls — so a new write cannot forget to notify the other screens,
because it cannot skip its own audit entry. They are held until the transaction
**commits**: telling the building a bed was taken and then rolling back would be
worse than not telling them.

What is live today: the patient chart (reloads and says *"this chart was updated
by someone else"* rather than swapping content silently), the ward board, and the
workspace lists behind every screen. The header shows **"Not live"** when the
connection drops — staff need to know when what they are looking at has stopped
updating.

A hidden tab releases its connection after a minute and resyncs when you return.
Over HTTP/1.1 a browser allows only six connections per origin, and an open
stream holds one for as long as the tab lives — without this, someone with
several tabs open would find the next one unable to load anything.

---

## 3. Laboratory — how a report is filled in, and why the numbers are right

The workflow was already `ORDERED → SAMPLE_COLLECTED → PROCESSING →
RESULT_ENTERED → VERIFIED → RELEASED`, with amendments versioned. What was
missing was the judgement applied to each number. Four distinct failures, each of
which has harmed patients in real laboratories:

### 3a. The wrong reference range

A haemoglobin of **12.5 g/dL** is unremarkable in an adult woman and anaemic in
an adult man. One range per analyte guarantees a wrong answer for somebody.
Ranges are now banded by sex and age, and the band is chosen for the patient the
sample belongs to:

```
male   age 39 · Hb 12.5 → range 13–17 → LOW
female age 42 · Hb 12.5 → range 12–15 → NORMAL
```

**Age outranks sex**, and that is not a detail — my first implementation scored
sex higher and handed an eight-year-old boy the adult male range, calling his
normal haemoglobin anaemic. The verification caught it before it shipped. When
nothing matches (sex not recorded, age outside every band) the general range is
used *and the report says so*, rather than implying a range was chosen for this
person.

### 3b. A typing mistake read as a crisis

`145` entered for a haemoglobin meant as `14.5` is not a critical result, it is a
slipped decimal point. Treating it as critical starts a call-the-doctor cascade
over a keystroke — and teaches everyone to distrust critical alerts.

```
Hb 145 → refused (422)
  "145 g/dL is above the highest value this assay can produce (25 g/dL).
   Did you mean 14.5 g/dL?"
```

### 3c. A result from the wrong patient

The delta check is the laboratory's standard guard against a mislabelled sample.
Compared against **this patient's own** previous result:

```
K 4.1 → 6.9 : "Potassium has changed from 4.1 to 6.9 mmol/L (68% change).
               Confirm the sample belongs to this patient before filing."
```

It warns, it does not block — genuine dramatic changes happen, and a technician
who has checked the sample must be able to proceed. The note is stored on the
result and shown beside the value, not buried on another screen.

### 3d. Derived values calculated by hand

eGFR, corrected calcium and LDL are arithmetic on other results. Typed by a
person they are a source of error; computed by the platform they are
reproducible, and they carry the conditions under which the formula does not
apply:

```
female age 42, creatinine 1.0  →  eGFR 72 mL/min/1.73m²   (marked "calculated")
male   age 39, creatinine 1.0  →  eGFR 98 mL/min/1.73m²
```

CKD-EPI 2021, the race-free equation, verified against published worked examples.
It refuses rather than guesses when sex or age is unrecorded, and refuses for
children because it is an adult equation.

Friedewald LDL above a triglyceride of 400 mg/dL **reports why it is withheld**
instead of printing a number — that is the classic case of a formula quietly
producing a reassuring figure for a patient who is not reassuring.

---

## 4. Patient data mismatch and overwrite

The failure this prevents: a receptionist opens a patient to correct a phone
number while a nurse opens the same patient to change the treating doctor. Both
press Save. Whoever saves second sends the whole form, including their stale copy
of the other person's field, and the first edit disappears with no error and no
trace. In a hospital the erased field might be an allergy.

A blunt version check would be its own problem — it would refuse the phone-number
edit even though the two people touched *different* fields, and staff refused for
no visible reason learn to retry blindly. So the check compares **fields**:

```
A edits mobile (v1)              → saved, v2
B edits mobile, still holding v1 → 409 REFUSED
      "Sunita Kale changed mobile on this patient record while you were editing.
       Your change was not saved, so nothing has been lost."
      mine: +919820194841  →  theirs: +919876500011
B edits email, still holding v1  → allowed — no real conflict
```

Neither person's change is lost, and neither is interrupted without cause. The
conflict report is reconstructed from the clinical audit trail, so it is derived
from the same evidence the hospital would use to investigate one and cannot drift
from it. The dialog shows both values and makes the user choose; overriding is
still possible, but it is explicit and audited — the danger was never that a
person could overrule a colleague, it was doing so unknowingly.

Blind writes (imports, the voice agent stamping a last-contact time) are still
allowed: they send no version, and the check is skipped rather than guessed at.

---

## 5. The connections themselves

**Laboratory → ward.** The ward board now shows, per bed, the occupant's
outstanding lab orders and — in red — their **unacknowledged critical results**.
A ward round happens at the bedside, so that is where "is anything outstanding
for this patient" has to be answerable. Two queries for the whole board, not two
per bed.

**Laboratory → billing.** Releasing a report raises a charge carrying the id of
the order that caused it. Not ordering (may be cancelled), not entering results
(may be repeated) — releasing. An amended report re-released later does **not**
bill the patient twice, because the source id is unique. A cancelled order
withdraws its charge.

**Ward → billing.** Bed-days are recomputed from the ward assignments on transfer
and discharge, one line per calendar day at that bed's rate. Recomputing rather
than incrementing means a backdated discharge, a transfer between beds at
different rates, or a server that was off overnight all produce the same correct
set of days.

Charges are **derived, never typed**. Billing in most hospital software is a
parallel universe where somebody reads the chart and re-types it into an invoice;
every step of that is a chance to bill for a cancelled test or charge the wrong
patient, and the bill then disagrees with the record it came from.

---

## 6. Defects found while doing this — and fixed

**A lab technician could not see the critical results list.** They could record
"ward notified" (needs `labs.result`) but the list itself required
`escalations.view`, which they do not hold. The person whose job is to telephone
the ward about a critical potassium could not see which results needed
telephoning. Fixed with a permission check satisfied by *any* of several
permissions, rather than granting anyone access they should not have.

**Duplicate detection scanned the whole register per row.** The name-and-DOB
match could use no index, so importing 500 patients into a hospital of 8,000
evaluated four million rows. An index on `(org_id, date_of_birth)` turns it into
a handful of comparisons — a 1-row import now commits in **9 ms** at 8,048
patients.

**My own age-vs-sex precedence bug**, described in 3a, caught by verification
before it shipped.

---

## 7. Performance still holds

Same tenant, 8,048 patients, 24 concurrent users:

| Endpoint | p95 | Payload |
|---|---|---|
| `GET /api/bootstrap` (every page load) | **133 ms** | 16 KB |
| `GET /api/patients/:id` (a full chart) | 95 ms | 39 KB |
| `GET /api/beds` (ward board, now with lab state) | 70 ms | 22 KB |
| `POST vitals` × 24 concurrent | 69 ms | 0 lock errors |
| 24 staff claiming one bed | 1 won, 23 correctly refused | 0 errors |

---

## 8. Tests

| Suite | Checks |
|---|---|
| `tests/suite.mjs` | 189 — SaaS lifecycle, CRUD, tenant isolation, RBAC, voice, exports |
| `tests/clinical.mjs` | 137 — 32-step clinical scenario, bed race, IDOR |
| `tests/ui.mjs` | 77 — browser CRUD, settings, mobile |
| `tests/clinical-ui.mjs` | 37 — clinical screens, role restrictions, the guide |
| `tests/ux.mjs` | 27 — operating-friction regressions |
| **`tests/connected.mjs`** | **41 — new: the whole chain above** |
| **Total** | **508, 0 failing** |

`tests/load.mjs` is the load diagnostic; `scripts/seed-volume.mjs` fills a tenant
to make it meaningful.

---

## 9. What is still not done

Unchanged from the previous audit and still true:

- `/portal` (six patient-facing buttons), `/billing` "Send payment link",
  `/calls` "Play recording", `/admin/integrations` sync, `/settings/plan`, and
  the `/admin/org` Add modal still do nothing.
- Missing confirmations on discarding a call, cancelling an appointment, pausing
  a published agent, and the patient consent toggles.
- **The patient profile shares one `form` state across nine modals and never
  clears it on cancel.** Open "Record vitals", type, cancel, open "Prescribe" —
  the stale vitals keys are still in `form`. This should be fixed before anyone
  uses that screen on a real patient.
- OT scheduling, pharmacy dispensing, and the real doctor/department form are
  still not built.

New, and specific to this work:

- **Live updates are in-process.** Correct for the single-node deployment this
  ships as; running several nodes means replacing `publish`/`subscribe` with
  Redis or Postgres LISTEN/NOTIFY. No caller knows how delivery happens, so
  nothing else changes.
- **Optimistic concurrency covers patient demographics only.** Encounters,
  medication orders and diagnoses are not yet version-checked.
- **The reference ranges and prices in the catalogue are a starting point, not a
  validated set.** They are method- and instrument-specific in every real
  laboratory and must be replaced with the hospital's own before any clinical
  use. The mechanism is correct; the numbers in it are illustrative.

**This is not production ready.** What is tested above is genuinely tested. The
list in this section is what stands between it and a hospital using it.
