# Security, privacy, data-integrity and SaaS readiness review

Review date: 16 September 2026

## Decision

The current deployment is suitable for a controlled demonstration with synthetic data. It is **not approved for real patient data or hospital production use on Render's free plan**.

The main blocker is durability: the free service writes its SQLite database and local files to `/tmp`. That storage is ephemeral, so a restart or replacement can erase data. A paid persistent disk improves durability, but a public multi-tenant SaaS should move the database to managed PostgreSQL and encrypted recordings/exports to object storage, with automated off-site backups and tested restores.

No automated review can prove that software is “unhackable.” This review records the controls tested, the flaws fixed, and the remaining work that needs independent verification.

## Verified in this review

- 153 adversarial API checks passed with no successful attack. They cover unauthenticated access, cross-hospital access, privilege escalation, mass assignment, SQL injection payloads, stored markup, prototype pollution, path traversal, forged sessions, brute force, information leakage, CORS, audit-log mutation, SSRF payloads, webhook forgery, enumeration, malformed bodies and oversized input.
- 27 concurrent-operation checks passed. They cover simultaneous sign-ins, unique registrations, parallel vital observations, two admissions competing for one bed, patient edit conflicts, concurrent reads/writes, reused sessions and duplicate registrations.
- Production dependencies report zero known vulnerabilities after pinning patched `postcss` and `uuid` versions.
- TypeScript compilation and the production build pass. Lint has five existing unused-variable warnings and no errors.
- Patient edits use optimistic concurrency, a bed cannot have two active admissions, hospital numbers are unique, append-only observations are preserved, and SQLite runs with WAL and busy-timeout protection.
- Sessions are HTTP-only, same-site cookies; authorization is enforced server-side; tenant ids come from the signed-in session; sensitive routes are permission-gated; secrets are masked in browser responses.
- Recordings and exports support AES-256-GCM application encryption when `STORAGE_ENCRYPTION_KEY` is configured.
- Audit events cannot be created, edited or deleted through the public record APIs.

## Flaws fixed in this review

1. **Bootstrap privacy leak.** A limited user could receive the hospital staff directory and administrative settings in the initial workspace response. The response now applies the same permission checks as the dedicated APIs.
2. **Duplicate voice events and billing.** Normal Retell lifecycle events and webhook retries could create duplicate call records. Only the final analysed event is persisted, and provider event ids are claimed atomically.
3. **Webhook resource abuse.** Retell webhooks now have a one-megabyte body limit and per-address rate limiting.
4. **Server detail leakage.** Unexpected exceptions are logged on the server while clients receive a generic error.
5. **Known package vulnerabilities.** Patched transitive versions are locked and the production audit is clean.
6. **False call success.** If a live voice provider fails, the request now fails visibly. It can no longer be silently changed into a simulated call.

## Data-overwrite guarantees and limits

The tests prove that the supported high-risk workflows resist the races listed above; they do not prove that every future write is conflict-free.

- Patient demographics reject stale edits through a version check.
- Vitals and other observations are append-only.
- Bed occupancy and active admission constraints are enforced by the database.
- Retell webhook retries are idempotent.
- Lower-risk generic configuration records still use last-write-wins. Add a version column and an `If-Match` style check before allowing several administrators to edit the same configuration concurrently.
- Audit rows are application-immutable, but an operator with direct database access can still alter SQLite. Production-grade tamper evidence needs append-only remote logging with hash chaining or write-once retention.

## Remaining launch blockers

1. Replace ephemeral free-plan storage before entering real data.
2. Automate encrypted off-site backups and restore drills; set recovery-time and recovery-point targets.
3. Add uptime, error, disk, database-lock and failed-call alerts with a 24/7 owner.
4. Enforce MFA for all patient-data users and review privileged access regularly.
5. Enforce retention, export and deletion workflows rather than only storing settings.
6. Remove `'unsafe-inline'` from the script Content Security Policy by introducing per-request nonces.
7. Commission an independent penetration test and remediate its findings.
8. Prepare an incident-response runbook. CERT-In directions can require reportable cyber incidents to be reported within six hours.
9. Complete privacy notices, consent records, data-processing contracts, subprocessor review, data-subject request handling and legal review against India's DPDP framework.
10. Obtain clinical and regulatory review for decision-support behavior, laboratory reference ranges, medication warnings, call recording, ABDM/ABHA claims and automated outbound calling.

## Keeping upgrades simple

Keep one modular monolith until real load proves it needs to split. Use one deployment, one relational database and one object store. Put vendor-specific code behind narrow adapters, and keep clinical rules separate from UI and telephony code. Add schema migrations and contract tests for each adapter. Avoid introducing queues, Redis or microservices until a measured reliability or scale requirement needs them.

For voice, use these stable internal capabilities instead of vendor names:

- `placeCall` and `transferCall` for telephony
- `streamAudio` for a real-time media connection
- `transcribe`, `synthesize` and `interrupt` for speech
- `verifyWebhook` and `normaliseEvent` for provider callbacks
- `getRecording` and `deleteRecording` for lifecycle control

Each provider adapter should declare its supported regions, data-retention behavior, consent features and health status. This lets the settings screen render from adapter metadata and avoids adding a new set of conditionals for every vendor.

## Voice choices beyond Retell and ElevenLabs

| Option | Best use | Trade-off |
|---|---|---|
| Exotel AgentStream + Sarvam AI | India-first phone numbers and regional-language speech | Requires a WebSocket media service and contracts with two vendors |
| Twilio ConversationRelay | Mature programmable telephony and a managed conversation transport | Verify India number availability, data region and healthcare contractual terms for the exact services used |
| Deepgram Voice Agent + Exotel or Twilio | One real-time speech/agent socket with a separate PSTN carrier | More integration work, but greater control over models and data flow |
| Vapi | Fastest managed replacement for Retell | Complete a healthcare, retention, subprocessor and regional-data review before patient use |

For an India-focused first pilot, the preferred path is **Exotel AgentStream for telephony plus Sarvam AI or Deepgram for speech**, hosted as a small separate WebSocket worker. The existing Next.js service should remain the system of record and issue short-lived, minimum-data call instructions. This confines the real-time complexity without turning the product into microservices.

Before selecting any vendor, obtain written answers for data location, model-training use, deletion, recording retention, breach notification, subprocessor list, encryption, audit reports and contractual responsibility for health data.
