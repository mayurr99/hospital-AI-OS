import { legacyPatientShape } from "@/lib/server/patients";
import { randomBytes } from "node:crypto";
import { body, handler } from "@/lib/server/route";
import { HttpError, audit, requireOrg, userCan } from "@/lib/server/auth";
import { all, id, nowIso, records, run, settings } from "@/lib/server/db";
import { storageFor } from "@/lib/server/storage";
import { EXPORT_TEMPLATES } from "@/lib/server/exports";
import type { Appointment, CallSession, Escalation, Invoice, Patient } from "@/lib/types";



function csv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

export async function GET() {
  return handler(async () => {
    const { orgId } = await requireOrg("data.export");
    const rows = all<Record<string, unknown>>(
      "SELECT * FROM export_jobs WHERE org_id = ? ORDER BY created_at DESC LIMIT 100", [orgId],
    );
    return {
      templates: EXPORT_TEMPLATES,
      jobs: rows.map((e) => ({
        id: e.id, requestedBy: e.requested_by, template: e.template, scope: JSON.parse(String(e.scope || "{}")),
        status: e.status, rows: e.rows, bytes: e.bytes, downloadToken: e.download_token,
        expiresAt: e.expires_at, downloadedAt: e.downloaded_at, createdAt: e.created_at, completedAt: e.completed_at,
      })),
    };
  });
}

export async function POST(req: Request) {
  return handler(async () => {
    const { session, orgId } = await requireOrg("data.export");
    const b = await body<{ template: string; maskPhone?: boolean; includeClinical?: boolean; days?: number }>(req);

    const template = EXPORT_TEMPLATES.find((t) => t.id === b.template);
    if (!template) throw new HttpError(400, "Unknown export template");

    /* column-level filtering is decided by the requester's own permissions, on the server */
    const mayReadClinical = userCan(session.user, "patients.clinical.view");
    const includeClinical = Boolean(b.includeClinical) && mayReadClinical;
    const maskPhone = b.maskPhone !== false;
    const since = b.days ? Date.now() - b.days * 86400000 : 0;
    const mask = (p: string) => (maskPhone ? `••••••${p.slice(-4)}` : p);

    let rows: Record<string, unknown>[] = [];
    if (template.id === "patients") {
      /* An export is the one caller that legitimately wants every patient. */
      rows = (legacyPatientShape(orgId, { limit: Infinity }) as unknown as Patient[]).map((p) => ({
        MRN: p.mrn, Name: p.name, Age: p.age, Gender: p.gender, Phone: mask(p.phone), Language: p.language,
        Status: p.status, Risk: p.risk, Diagnosis: includeClinical ? p.diagnosis : "[restricted]",
        CarePathway: includeClinical ? p.carePathway : "[restricted]",
        ConsentClinicalCalls: p.consent.clinicalCalls ? "yes" : "no", LastContact: p.lastContact ?? "",
      }));
    } else if (template.id === "calls" || template.id === "followups") {
      rows = records
        .list<CallSession>(orgId, "call")
        .filter((c) => new Date(c.startedAt).getTime() >= since)
        .filter((c) => (template.id === "followups" ? c.agentType === "care" : true))
        .map((c) => ({
          CallID: c.id, Patient: c.patientName, Phone: mask(c.phone), Direction: c.direction, Agent: c.agentType,
          Language: c.language, Started: c.startedAt, DurationSec: c.durationSeconds, Status: c.status,
          Outcome: c.outcome, Risk: c.risk, Review: c.reviewStatus, Feedback: c.sentimentScore,
          Summary: includeClinical ? c.summary : "[restricted]",
          ...(includeClinical ? c.structured : {}),
          AgentVersion: c.agentVersion, ProtocolVersion: c.protocolVersion, CostINR: c.costRupees,
        }));
    } else if (template.id === "escalations") {
      rows = records.list<Escalation>(orgId, "escalation").map((e) => ({
        ID: e.id, Level: e.level, Trigger: e.trigger, Raised: e.raisedAt, Status: e.status,
        SLAMinutes: e.slaMinutes, Acknowledged: e.acknowledgedAt ?? "", Resolved: e.resolvedAt ?? "",
        Resolution: includeClinical ? (e.resolutionNote ?? "") : "[restricted]",
      }));
    } else if (template.id === "appointments") {
      rows = records.list<Appointment>(orgId, "appointment").map((a) => ({
        ID: a.id, Start: a.start, DurationMin: a.durationMinutes, Status: a.status, Source: a.source, Reason: a.reason,
      }));
    } else if (template.id === "billing") {
      rows = records.list<Invoice>(orgId, "invoice").map((i) => {
        const total = i.lines.reduce((s, l) => s + l.qty * l.rate, 0) - i.discount;
        return { Invoice: i.number, Issued: i.issuedAt, Payer: i.payer, Insurer: i.insurer ?? "", Total: total, Paid: i.paid, Outstanding: total - i.paid, Status: i.status };
      });
    } else if (template.id === "recordings") {
      rows = all<Record<string, unknown>>("SELECT * FROM recordings WHERE org_id = ?", [orgId]).map((r) => ({
        ID: r.id, CallID: r.call_id, Storage: r.storage_kind, Key: r.storage_key, Bytes: r.bytes,
        DurationSec: r.duration_secs, RetentionUntil: r.retention_until, Created: r.created_at,
      }));
    }

    const content = csv(rows);
    const jobId = id("exp");
    const token = randomBytes(24).toString("hex");
    const key = `exports/${jobId}.csv`;
    const { driver } = storageFor(orgId);
    const stored = await driver.put(key, Buffer.from(content, "utf8"), "text/csv");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    run(
      `INSERT INTO export_jobs (id, org_id, requested_by, template, scope, status, rows, bytes, storage_key,
         download_token, expires_at, created_at, completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        jobId, orgId, session.user.name, template.id,
        JSON.stringify({ maskPhone, includeClinical, days: b.days ?? null }),
        "ready", rows.length, stored.bytes, stored.key, token, expiresAt, nowIso(), nowIso(),
      ],
    );

    audit(
      session,
      "export.generated",
      `${template.label} — ${rows.length} rows, phone ${maskPhone ? "masked" : "full"}, clinical ${includeClinical ? "included" : "excluded"}, stored in ${driver.kind}`,
      "critical",
    );
    void settings;

    return {
      ok: true,
      job: { id: jobId, template: template.id, rows: rows.length, bytes: stored.bytes, downloadToken: token, expiresAt },
      downloadUrl: `/api/exports/${jobId}/download?token=${token}`,
    };
  });
}
