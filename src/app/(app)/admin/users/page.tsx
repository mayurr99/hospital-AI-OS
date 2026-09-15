"use client";

import { Fragment, useMemo, useState } from "react";
import { useOrgData, useStore } from "@/lib/store";
import { Denied } from "@/components/AppShell";
import {
  Avatar, Badge, Button, Card, CardHeader, Field, Input, Modal, PageHeader, Select, StatTile, Table,
  Tabs, Td, Th, Toggle, Tr,
} from "@/components/ui";
import { ALL_PERMISSIONS, effectivePermissions, ROLE_LABELS, ROLE_PERMISSIONS } from "@/lib/rbac";
import { cx, fmtDate, relative } from "@/lib/utils";
import { api } from "@/lib/http";
import type { Permission, Role, User } from "@/lib/types";
import {
  CheckCircle2, KeyRound, Lock, Mail, ShieldAlert, ShieldCheck, Trash2, UserCog, UserPlus, Users, X,
} from "lucide-react";

type TabKey = "people" | "matrix" | "roles";

const ASSIGNABLE_ROLES: Role[] = ["hospital_admin", "doctor", "nurse", "receptionist", "pharmacist", "lab_tech", "billing"];

export default function AdminUsersPage() {
  const { can, inviteUser, saveUser, removeUser, notify, currentUser, org } = useStore();
  const d = useOrgData();
  const [tab, setTab] = useState<TabKey>("people");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [editing, setEditing] = useState<User | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null);
  const [invite, setInvite] = useState({ name: "", email: "", phone: "", role: "nurse" as Role, facilityId: "", departmentId: "", mfa: true });
  const [recovery, setRecovery] = useState<null | "mfa" | "pwd">(null);
  const [resetLink, setResetLink] = useState<{ url: string; minutes: number } | null>(null);

  const orgUsers = useMemo(
    () =>
      d.users.filter((u) => {
        if (roleFilter !== "all" && u.role !== roleFilter) return false;
        if (statusFilter !== "all" && u.status !== statusFilter) return false;
        return true;
      }),
    [d.users, roleFilter, statusFilter],
  );

  if (!can("users.manage")) return <Denied />;

  const groups = Array.from(new Set(ALL_PERMISSIONS.map((p) => p.group)));

  async function saveEdit(u: User) {
    await saveUser(u.id, {
      name: u.name, phone: u.phone, role: u.role, status: u.status,
      facilityId: u.facilityId, departmentId: u.departmentId, mfaEnabled: u.mfaEnabled,
      extraPermissions: u.extraPermissions, revokedPermissions: u.revokedPermissions,
    });
    notify("User updated — changes take effect on their next request");
    setEditing(null);
  }

  async function runRecovery(userId: string, action: "reset-mfa" | "issue-password-reset") {
    setRecovery(action === "reset-mfa" ? "mfa" : "pwd");
    setResetLink(null);
    try {
      const data = await api<{ resetPath?: string; expiresInMinutes?: number }>(
        `/api/users/${userId}/security`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) },
      );
      if (action === "reset-mfa") {
        notify("Authenticator reset — they will set up a new one at their next sign-in, and their sessions have ended");
        setEditing((cur) => (cur && cur.id === userId ? { ...cur, mfaEnrolled: false } : cur));
      } else if (data.resetPath) {
        setResetLink({
          url: `${window.location.origin}${data.resetPath}`,
          minutes: data.expiresInMinutes ?? 60,
        });
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : "That did not work");
    } finally {
      setRecovery(null);
    }
  }

  function togglePermission(u: User, key: Permission) {
    const base = new Set(ROLE_PERMISSIONS[u.role]);
    const has = effectivePermissions(u).has(key);
    let extra = [...u.extraPermissions];
    let revoked = [...u.revokedPermissions];
    if (has) {
      if (base.has(key)) revoked = [...revoked, key];
      else extra = extra.filter((p) => p !== key);
    } else {
      if (base.has(key)) revoked = revoked.filter((p) => p !== key);
      else extra = [...extra, key];
    }
    setEditing({ ...u, extraPermissions: extra, revokedPermissions: revoked });
  }

  return (
    <>
      <PageHeader
        title="Users & roles"
        subtitle={`${org?.name} · role-based access, per-user overrides and lifecycle control`}
        actions={<Button variant="primary" icon={<UserPlus size={15} />} onClick={() => setInviteOpen(true)}>Invite user</Button>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile label="Total users" value={d.users.length} icon={<Users size={15} />} tone="brand" />
        <StatTile label="Active" value={d.users.filter((u) => u.status === "active").length} tone="green" icon={<CheckCircle2 size={15} />} />
        <StatTile label="Pending invites" value={d.users.filter((u) => u.status === "invited").length} tone="amber" icon={<Mail size={15} />} />
        <StatTile label="Suspended" value={d.users.filter((u) => u.status === "suspended").length} tone={d.users.filter((u) => u.status === "suspended").length ? "red" : "neutral"} icon={<Lock size={15} />} />
        {/* Marked "flagged", not "enabled": nothing in the sign-in path challenges
            for a second factor yet, and a green tile saying otherwise would be a
            false assurance to the person responsible for the hospital's security. */}
        <StatTile
          label="Two-step sign-in set up"
          value={`${d.users.filter((u) => u.mfaEnrolled).length} of ${d.users.length}`}
          icon={<KeyRound size={15} />}
          tone={d.users.some((u) => u.mfaEnabled && !u.mfaEnrolled) ? "amber" : "green"}
        />
      </div>

      <Card padded={false}>
        <div className="border-b border-ink-200 px-4 pt-2">
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { key: "people", label: "People", count: d.users.length },
              { key: "matrix", label: "Permission matrix" },
              { key: "roles", label: "Role templates" },
            ]}
          />
        </div>

        {tab === "people" && (
          <>
            <div className="flex flex-wrap gap-2 border-b border-ink-200 px-4 py-3">
              <Select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="w-auto">
                <option value="all">All roles</option>
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </Select>
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-auto">
                <option value="all">Any status</option>
                <option value="active">Active</option>
                <option value="invited">Invited</option>
                <option value="suspended">Suspended</option>
              </Select>
            </div>

            <Table>
              <thead>
                <tr><Th>User</Th><Th>Role</Th><Th>Scope</Th><Th>Permissions</Th><Th>MFA</Th><Th>Last login</Th><Th>Status</Th><Th /></tr>
              </thead>
              <tbody>
                {orgUsers.map((u) => {
                  const eff = effectivePermissions(u);
                  const overrides = u.extraPermissions.length + u.revokedPermissions.length;
                  return (
                    <Tr key={u.id}>
                      <Td>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={u.name} size={32} hue={u.role === "doctor" ? 200 : u.role === "nurse" ? 280 : 170} />
                          <span>
                            <span className="block text-sm font-medium text-ink-900">{u.name}</span>
                            <span className="block text-[11px] text-ink-400">{u.email}</span>
                          </span>
                        </div>
                      </Td>
                      <Td><Badge tone={u.role === "hospital_admin" ? "purple" : "neutral"}>{ROLE_LABELS[u.role]}</Badge></Td>
                      <Td className="text-xs text-ink-500">
                        {d.facilities.find((f) => f.id === u.facilityId)?.name.split("—")[1]?.trim() ?? "All facilities"}
                        {u.departmentId && <span className="block">{d.departments.find((x) => x.id === u.departmentId)?.name}</span>}
                      </Td>
                      <Td className="text-xs">
                        <span className="font-medium text-ink-900">{eff.size}</span>
                        {overrides > 0 && <Badge tone="amber" className="ml-1.5">{overrides} override{overrides > 1 ? "s" : ""}</Badge>}
                      </Td>
                      {/*
                        Two different facts, shown as two different things.
                        "Required" is the hospital's policy; "set up" is whether
                        an authenticator actually exists. Collapsing them into
                        one green badge is what let this look protected while a
                        password alone still opened every record.
                      */}
                      <Td>
                        {u.mfaEnrolled ? (
                          <Badge tone="green">set up</Badge>
                        ) : u.mfaEnabled ? (
                          <Badge tone="amber">required — pending</Badge>
                        ) : (
                          <Badge tone="neutral">off</Badge>
                        )}
                      </Td>
                      <Td className="text-xs text-ink-500">{u.lastLogin ? relative(u.lastLogin) : "never"}</Td>
                      <Td>
                        <Badge tone={u.status === "active" ? "green" : u.status === "invited" ? "amber" : "red"}>{u.status}</Badge>
                      </Td>
                      <Td>
                        <div className="flex gap-1">
                          <Button size="sm" icon={<UserCog size={13} />} onClick={() => setEditing(u)}>Manage</Button>
                          {u.id !== currentUser?.id && (
                            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(u)}><Trash2 size={13} /></Button>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </>
        )}

        {tab === "matrix" && (
          <div className="overflow-x-auto p-4">
            <table className="w-full min-w-[900px] border-collapse text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 border-b border-ink-200 bg-white px-3 py-2 text-left font-semibold text-ink-600">Permission</th>
                  {d.users.slice(0, 12).map((u) => (
                    <th key={u.id} className="border-b border-ink-200 px-2 py-2 text-center">
                      <span className="block truncate text-[10px] font-medium text-ink-800">{u.name.split(" ")[0]}</span>
                      <span className="block text-[9px] text-ink-400">{u.role.replace("_", " ")}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g}>
                    <tr>
                      <td colSpan={13} className="sticky left-0 bg-ink-50 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500">{g}</td>
                    </tr>
                    {ALL_PERMISSIONS.filter((p) => p.group === g).map((p) => (
                      <tr key={p.key}>
                        <td className="sticky left-0 z-10 border-b border-ink-100 bg-white px-3 py-1.5 text-ink-700">{p.label}</td>
                        {d.users.slice(0, 12).map((u) => {
                          const has = effectivePermissions(u).has(p.key);
                          const isOverride = u.extraPermissions.includes(p.key) || u.revokedPermissions.includes(p.key);
                          return (
                            <td key={u.id} className="border-b border-ink-100 px-2 py-1.5 text-center">
                              <span
                                className={cx(
                                  "inline-grid h-5 w-5 place-items-center rounded",
                                  has ? "bg-emerald-100 text-emerald-700" : "bg-ink-100 text-ink-300",
                                  isOverride && "ring-2 ring-amber-400",
                                )}
                              >
                                {has ? <CheckCircle2 size={12} /> : <X size={11} />}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[11px] text-ink-500">
              <span className="mr-1 inline-block h-3 w-3 rounded ring-2 ring-amber-400 align-middle" /> ringed cells are
              per-user overrides on top of the role template.
            </p>
          </div>
        )}

        {tab === "roles" && (
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {ASSIGNABLE_ROLES.map((r) => (
              <div key={r} className="rounded-xl border border-ink-200 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold text-ink-900">{ROLE_LABELS[r]}</p>
                  <Badge tone="brand">{ROLE_PERMISSIONS[r].length}</Badge>
                </div>
                <p className="mb-2 text-[11px] text-ink-500">
                  {d.users.filter((u) => u.role === r).length} user(s) with this role
                </p>
                <div className="flex flex-wrap gap-1">
                  {ROLE_PERMISSIONS[r].slice(0, 10).map((p) => (
                    <span key={p} className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-600">{p}</span>
                  ))}
                  {ROLE_PERMISSIONS[r].length > 10 && (
                    <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-500">+{ROLE_PERMISSIONS[r].length - 10} more</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* manage user */}
      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        wide
        title={editing ? `Manage ${editing.name}` : ""}
        subtitle={editing ? `${editing.email} · created ${fmtDate(editing.createdAt)}` : ""}
        footer={
          editing && (
            <>
              <Button onClick={() => setEditing(null)}>Cancel</Button>
              <Button variant="primary" onClick={() => saveEdit(editing)}>Save changes</Button>
            </>
          )
        }
      >
        {editing && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Role" hint="Changing the role resets the permission template">
                <Select
                  value={editing.role}
                  onChange={(e) => setEditing({ ...editing, role: e.target.value as Role, extraPermissions: [], revokedPermissions: [] })}
                >
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Status">
                <Select value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value as User["status"] })}>
                  <option value="active">Active</option>
                  <option value="invited">Invited</option>
                  <option value="suspended">Suspended — access blocked immediately</option>
                </Select>
              </Field>
              <Field label="Facility scope">
                <Select value={editing.facilityId ?? ""} onChange={(e) => setEditing({ ...editing, facilityId: e.target.value || null })}>
                  <option value="">All facilities</option>
                  {d.facilities.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Department scope">
                <Select value={editing.departmentId ?? ""} onChange={(e) => setEditing({ ...editing, departmentId: e.target.value || null })}>
                  <option value="">All departments</option>
                  {d.departments.map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </Select>
              </Field>
            </div>

            {/*
              What an administrator actually needs when someone is standing at
              the desk having lost a phone or forgotten a password. Both end
              that person's sessions and both are logged as critical.
            */}
            <div className="rounded-lg border border-ink-200 p-3">
              <p className="text-sm font-semibold text-ink-900">Recovery</p>
              <p className="mt-0.5 text-[11px] text-ink-500">
                Check who you are speaking to first — either action below lets them back into this account.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!editing.mfaEnrolled || recovery === "mfa"}
                  onClick={() => runRecovery(editing.id, "reset-mfa")}
                >
                  {recovery === "mfa" ? "Resetting…" : "Reset authenticator"}
                </Button>
                <Button size="sm" disabled={recovery === "pwd"} onClick={() => runRecovery(editing.id, "issue-password-reset")}>
                  {recovery === "pwd" ? "Issuing…" : "Issue password reset link"}
                </Button>
              </div>
              {!editing.mfaEnrolled && (
                <p className="mt-2 text-[11px] text-ink-400">
                  There is no authenticator on this account to reset.
                </p>
              )}
              {resetLink && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                  <p className="text-[11px] font-medium text-amber-900">
                    Give this link to them yourself — nothing has been emailed. It works once, for {resetLink.minutes} minutes.
                  </p>
                  <p className="mt-1.5 select-all break-all rounded bg-white px-2 py-1.5 font-mono text-[11px] text-ink-800 ring-1 ring-amber-200">
                    {resetLink.url}
                  </p>
                  <button
                    onClick={() => { navigator.clipboard?.writeText(resetLink.url).catch(() => {}); }}
                    className="mt-1.5 text-[11px] font-medium text-amber-900 underline-offset-2 hover:underline"
                  >
                    Copy link
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-lg border border-ink-200 px-3">
              <Toggle
                label="Require two-step sign-in"
                description="Asked for at every sign-in. If this account has no authenticator yet, the next sign-in makes them set one up before anything opens."
                checked={editing.mfaEnabled}
                onChange={(v) => setEditing({ ...editing, mfaEnabled: v })}
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-ink-900">Permissions</p>
                <p className="text-[11px] text-ink-500">
                  {effectivePermissions(editing).size} granted ·{" "}
                  {editing.extraPermissions.length + editing.revokedPermissions.length} override(s) on the{" "}
                  {ROLE_LABELS[editing.role]} template
                </p>
              </div>
              <div className="space-y-3">
                {groups.map((g) => (
                  <div key={g}>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">{g}</p>
                    <div className="grid gap-1 sm:grid-cols-2">
                      {ALL_PERMISSIONS.filter((p) => p.group === g).map((p) => {
                        const has = effectivePermissions(editing).has(p.key);
                        const inTemplate = ROLE_PERMISSIONS[editing.role].includes(p.key);
                        const isOverride = editing.extraPermissions.includes(p.key) || editing.revokedPermissions.includes(p.key);
                        return (
                          <button
                            key={p.key}
                            onClick={() => togglePermission(editing, p.key)}
                            className={cx(
                              "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition",
                              has ? "border-emerald-200 bg-emerald-50" : "border-ink-200 bg-white hover:bg-ink-50",
                              isOverride && "ring-2 ring-amber-300",
                            )}
                          >
                            <span className={cx("grid h-4 w-4 shrink-0 place-items-center rounded", has ? "bg-emerald-500 text-white" : "bg-ink-200 text-ink-400")}>
                              {has ? <CheckCircle2 size={11} /> : <X size={10} />}
                            </span>
                            <span className="flex-1 text-ink-700">{p.label}</span>
                            {!inTemplate && has && <Badge tone="amber">extra</Badge>}
                            {inTemplate && !has && <Badge tone="red">revoked</Badge>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* invite */}
      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite a user"
        subtitle="They receive an email invite and set their own password."
        footer={
          <>
            <Button onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!invite.name || !invite.email}
              onClick={async () => {
                const created = await inviteUser({
                  name: invite.name,
                  email: invite.email,
                  phone: invite.phone,
                  role: invite.role,
                  facilityId: invite.facilityId || null,
                  departmentId: invite.departmentId || null,
                  mfaEnabled: invite.mfa,
                });
                if (!created) return;
                notify(`Invite sent to ${created.email}`);
                setInviteOpen(false);
                setInvite({ name: "", email: "", phone: "", role: "nurse", facilityId: "", departmentId: "", mfa: true });
              }}
            >
              Send invite
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name" className="sm:col-span-2">
            <Input value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} placeholder="Dr. Priya Bhosale" />
          </Field>
          <Field label="Work email">
            <Input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="name@hospital.in" />
          </Field>
          <Field label="Mobile">
            <Input value={invite.phone} onChange={(e) => setInvite({ ...invite, phone: e.target.value })} placeholder="+91 …" />
          </Field>
          <Field label="Role">
            <Select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value as Role })}>
              {ASSIGNABLE_ROLES.map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Facility">
            <Select value={invite.facilityId} onChange={(e) => setInvite({ ...invite, facilityId: e.target.value })}>
              <option value="">All facilities</option>
              {d.facilities.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2 rounded-lg border border-ink-200 px-3">
            <Toggle label="Require two-step sign-in" description="They will be asked to set up an authenticator the first time they sign in." checked={invite.mfa} onChange={(v) => setInvite({ ...invite, mfa: v })} />
          </div>
          <div className="sm:col-span-2 rounded-lg bg-brand-50 p-3 text-xs text-brand-900 ring-1 ring-brand-200">
            <ShieldCheck size={13} className="mr-1 inline" />
            This user will receive <strong>{ROLE_PERMISSIONS[invite.role].length} permissions</strong> from the{" "}
            {ROLE_LABELS[invite.role]} template. You can add or revoke individual permissions afterwards.
          </div>
        </div>
      </Modal>

      {/* delete */}
      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Remove user"
        subtitle={confirmDelete?.name}
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                await removeUser(confirmDelete!.id);
                notify("User removed — active sessions revoked");
                setConfirmDelete(null);
              }}
            >
              Remove user
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">
          Access is revoked immediately and any active session is terminated. The user&apos;s historical actions remain in
          the audit trail — clinical records are never rewritten.
        </p>
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          <ShieldAlert size={14} /> Consider suspending instead if this person may return.
        </p>
      </Modal>

      <Card className="mt-4">
        <CardHeader title="Access control principles" icon={<Lock size={16} />} />
        <div className="grid gap-3 text-xs leading-relaxed text-ink-600 md:grid-cols-4">
          {[
            ["Least privilege", "A receptionist cannot open clinical detail — and neither can the receptionist AI agent. The same rule governs both."],
            ["Scoped, not global", "Users are scoped to a facility and optionally a department, so a branch admin never sees another branch's queues."],
            ["Overrides, tracked", "Individual permissions can be added or revoked on top of a role, and every override is visible in the matrix and the audit trail."],
            ["Tenant isolation", "No user of this hospital can query another hospital's data, regardless of permissions. Platform access is separately permissioned and logged."],
          ].map(([t, s]) => (
            <div key={t} className="rounded-lg border border-ink-200 p-3">
              <p className="mb-1 text-xs font-semibold text-ink-900">{t}</p>
              <p>{s}</p>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
