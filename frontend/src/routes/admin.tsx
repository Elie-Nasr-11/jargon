import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertCircle, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { AmbientCanvas } from "@/components/AmbientCanvas";
import { GradientCard } from "@/components/GradientCard";
import { SettingsMenu } from "@/components/SettingsMenu";
import { getSession, invokeAdminSeed, isPlatformAdmin } from "@/lib/api";
import type { AdminSeedResult, AdminSeedUser, PilotRole } from "@/lib/types";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Pilot Admin - Jargon" },
      { name: "description", content: "Seed pilot classrooms for Jargon." },
    ],
  }),
  component: AdminPage,
});

type RosterRow = AdminSeedUser & { rowId: string };

const MIN_TEMP_PASSWORD_LENGTH = 6;

const blankRow = (): RosterRow => ({
  rowId: Math.random().toString(36).slice(2),
  email: "",
  name: "",
  role: "student",
  grade: "",
  password: "",
});

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeRole(value: string): PilotRole {
  return value.trim().toLowerCase() === "teacher" ? "teacher" : "student";
}

function splitLine(line: string) {
  if (line.includes("\t")) return line.split("\t").map((part) => part.trim());
  return line.split(",").map((part) => part.trim());
}

function parseRosterPaste(value: string): RosterRow[] {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const first = splitLine(lines[0]).map((cell) => cell.toLowerCase());
  const hasHeader = first.some((cell) =>
    ["email", "name", "role", "grade", "password"].includes(cell),
  );
  const header = hasHeader ? first : ["email", "name", "role", "grade", "password"];
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines.map((line) => {
    const cells = splitLine(line);
    const record: Record<string, string> = {};
    header.forEach((field, index) => {
      record[field] = cells[index] || "";
    });
    return {
      rowId: Math.random().toString(36).slice(2),
      email: (record.email || "").toLowerCase(),
      name: record.name || "",
      role: normalizeRole(record.role || "student"),
      grade: record.grade || "",
      password: record.password || "",
    };
  });
}

function resultTone(status: AdminSeedResult["status"]) {
  if (status === "created") return "text-emerald-500";
  if (status === "reused" || status === "skipped") return "text-sky-500";
  return "text-red-500";
}

function AdminPage() {
  const navigate = useNavigate();
  const [booting, setBooting] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [orgName, setOrgName] = useState("Pilot School");
  const [orgSlug, setOrgSlug] = useState("pilot-school");
  const [className, setClassName] = useState("Jargon Pilot Class");
  const [defaultPassword, setDefaultPassword] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [rows, setRows] = useState<RosterRow[]>([blankRow()]);
  const [results, setResults] = useState<AdminSeedResult[]>([]);
  const [batchId, setBatchId] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const session = await getSession();
        if (!session) {
          navigate({ to: "/login", replace: true });
          return;
        }
        const allowed = await isPlatformAdmin(session.user.id);
        if (!alive) return;
        setEmail(session.user.email || "");
        setToken(session.access_token);
        setAuthorized(allowed);
        setMessage(allowed ? "" : "This area is available only to platform admins.");
      } catch (error) {
        if (!alive) return;
        setMessage((error as Error).message || "Could not load admin access.");
      } finally {
        if (alive) setBooting(false);
      }
    };
    run();
    return () => {
      alive = false;
    };
  }, [navigate]);

  const validRows = useMemo(
    () =>
      rows
        .map((row) => ({
          rowId: row.rowId,
          email: row.email.trim().toLowerCase(),
          name: row.name.trim(),
          role: row.role,
          grade: row.grade?.trim() || "",
          password: row.password?.trim() || "",
        }))
        .filter((row) => row.email || row.name),
    [rows],
  );

  const defaultPasswordValue = defaultPassword.trim();
  const hasDefaultPassword = defaultPasswordValue.length >= MIN_TEMP_PASSWORD_LENGTH;
  const hasShortDefaultPassword =
    defaultPasswordValue.length > 0 && defaultPasswordValue.length < MIN_TEMP_PASSWORD_LENGTH;

  const emailErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    validRows.forEach((row) => {
      if (!row.email) errors[row.rowId] = "Email required.";
      else if (!row.email.includes("@")) errors[row.rowId] = "Use a valid email.";
    });
    return errors;
  }, [validRows]);

  const nameErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    validRows.forEach((row) => {
      if (!row.name) errors[row.rowId] = "Name required.";
    });
    return errors;
  }, [validRows]);

  const passwordErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    validRows.forEach((row) => {
      if (row.password && row.password.length < MIN_TEMP_PASSWORD_LENGTH) {
        errors[row.rowId] = "Use 6+ characters.";
      } else if (!row.password && !hasDefaultPassword) {
        errors[row.rowId] = "Set a default or add an override.";
      }
    });
    return errors;
  }, [hasDefaultPassword, validRows]);

  const formErrors = useMemo(() => {
    const errors: string[] = [];
    if (!orgName.trim()) errors.push("Organization name is required.");
    if (!className.trim()) errors.push("Class name is required.");
    if (!validRows.length) errors.push("Add at least one teacher or student.");
    if (hasShortDefaultPassword) {
      errors.push(
        `Default temporary password must be at least ${MIN_TEMP_PASSWORD_LENGTH} characters.`,
      );
    }
    if (Object.keys(emailErrors).length || Object.keys(nameErrors).length) {
      errors.push("Every roster row needs a valid email and name.");
    }
    if (Object.keys(passwordErrors).length) {
      errors.push("Every roster row needs a temporary password of at least 6 characters.");
    }
    return errors;
  }, [
    className,
    emailErrors,
    hasShortDefaultPassword,
    nameErrors,
    orgName,
    passwordErrors,
    validRows.length,
  ]);

  const canSeed = !submitting && formErrors.length === 0;

  const updateRow = (rowId: string, patch: Partial<RosterRow>) => {
    setRows((current) => current.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  };

  const removeRow = (rowId: string) => {
    setRows((current) =>
      current.length > 1 ? current.filter((row) => row.rowId !== rowId) : current,
    );
  };

  const applyPaste = () => {
    const parsed = parseRosterPaste(pasteText);
    if (!parsed.length) {
      setMessage("Paste at least one roster row first.");
      return;
    }
    setRows(parsed);
    setMessage(`Loaded ${parsed.length} roster ${parsed.length === 1 ? "row" : "rows"}.`);
  };

  const seedRoster = async () => {
    if (submitting || !token) return;
    if (formErrors.length) {
      setMessage(formErrors[0]);
      return;
    }
    setSubmitting(true);
    setMessage("");
    setResults([]);
    setBatchId("");

    try {
      if (!orgName.trim()) throw new Error("Organization name is required.");
      if (!className.trim()) throw new Error("Class name is required.");
      if (!validRows.length) throw new Error("Add at least one teacher or student.");

      const response = await invokeAdminSeed({
        accessToken: token,
        organization: {
          name: orgName.trim(),
          slug: slugify(orgSlug || orgName),
        },
        class: { name: className.trim() },
        defaultPassword: defaultPassword.trim(),
        users: validRows.map(({ rowId: _rowId, ...row }) => row),
      });
      setResults(response.results);
      setBatchId(response.batch_id || "");
      setMessage(
        response.results.some((result) => result.status === "failed")
          ? "Pilot roster seed finished with errors."
          : "Pilot roster seed finished.",
      );
    } catch (error) {
      setMessage((error as Error).message || "Could not seed the pilot roster.");
    } finally {
      setSubmitting(false);
    }
  };

  if (booting) {
    return <AdminShell email={email} message="Checking admin access..." />;
  }

  if (!authorized) {
    return (
      <AdminShell email={email} message={message || "Platform admin access is required."}>
        <Link
          to="/chat"
          className="mt-4 inline-flex text-[13px] text-muted-foreground hover:text-foreground"
        >
          Return to Jargon
        </Link>
      </AdminShell>
    );
  }

  return (
    <AdminShell email={email}>
      <main className="relative z-10 mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-5 px-5 py-8">
        <section className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
              Platform admin
            </div>
            <h1 className="font-serif mt-2 text-[38px] leading-tight tracking-tight text-foreground">
              Seed a pilot classroom.
            </h1>
            <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
              Create or reuse teacher and student accounts, then attach them to one organization and
              class. Passwords are sent only to Supabase Auth and are not stored in Jargon tables.
            </p>
          </div>
          <Link
            to="/teacher"
            className="rounded-full border border-border px-4 py-2 text-[13px] text-foreground transition-colors hover:bg-muted"
          >
            Open teacher shell
          </Link>
        </section>

        <div className="grid gap-5 lg:grid-cols-[0.92fr_1.08fr]">
          <GradientCard>
            <div className="space-y-5 p-5">
              <div>
                <h2 className="text-[16px] font-medium text-foreground">Class setup</h2>
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  Use stable names for the real classroom pilot.
                </p>
              </div>
              <Field label="Organization name">
                <input
                  value={orgName}
                  onChange={(event) => {
                    setOrgName(event.target.value);
                    if (!orgSlug || orgSlug === slugify(orgName))
                      setOrgSlug(slugify(event.target.value));
                  }}
                  className="jargon-input"
                />
              </Field>
              <Field label="Organization slug">
                <input
                  value={orgSlug}
                  onChange={(event) => setOrgSlug(event.target.value)}
                  className="jargon-input"
                />
              </Field>
              <Field label="Class name">
                <input
                  value={className}
                  onChange={(event) => setClassName(event.target.value)}
                  className="jargon-input"
                />
              </Field>
              <Field label="Default temporary password">
                <input
                  type="password"
                  value={defaultPassword}
                  onChange={(event) => setDefaultPassword(event.target.value)}
                  placeholder="Optional if every row has a password"
                  className={`jargon-input ${hasShortDefaultPassword ? "border-red-500/60" : ""}`}
                />
                <p
                  className={`mt-1.5 text-[12px] ${
                    hasShortDefaultPassword ? "text-red-500" : "text-muted-foreground"
                  }`}
                >
                  {hasShortDefaultPassword
                    ? `Use at least ${MIN_TEMP_PASSWORD_LENGTH} characters.`
                    : "Required unless every row has a password override."}
                </p>
              </Field>
              <div className="rounded-2xl border border-border bg-muted/30 p-3 text-[12.5px] leading-relaxed text-muted-foreground">
                Bootstrap note: the first platform admin is still created manually in Supabase by
                inserting the signed-in admin user id into <code>public.platform_admins</code>.
              </div>
            </div>
          </GradientCard>

          <GradientCard>
            <div className="space-y-4 p-5">
              <div>
                <h2 className="text-[16px] font-medium text-foreground">Roster paste</h2>
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  Paste CSV or tab-separated rows. Header fields can be email, name, role, grade,
                  password.
                </p>
              </div>
              <textarea
                value={pasteText}
                onChange={(event) => setPasteText(event.target.value)}
                placeholder={
                  "email,name,role,grade,password\nteacher@example.com,Teacher Name,teacher,,temporary123\nstudent@example.com,Student Name,student,Grade 4,temporary123"
                }
                className="min-h-[170px] w-full resize-y rounded-2xl border border-border bg-background/70 p-3 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/55 focus:border-foreground/50"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={applyPaste}
                  className="rounded-full bg-foreground px-4 py-2 text-[13px] font-medium text-background transition-transform hover:-translate-y-[1px]"
                >
                  Load pasted roster
                </button>
                <button
                  type="button"
                  onClick={() => setRows((current) => [...current, blankRow()])}
                  className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-[13px] text-foreground transition-colors hover:bg-muted"
                >
                  <Plus className="h-4 w-4" strokeWidth={1.6} /> Add row
                </button>
              </div>
            </div>
          </GradientCard>
        </div>

        <GradientCard>
          <div className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-medium text-foreground">Roster rows</h2>
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  {validRows.length} ready {validRows.length === 1 ? "account" : "accounts"}.
                </p>
              </div>
              <button
                type="button"
                onClick={seedRoster}
                disabled={!canSeed}
                title={formErrors[0] || "Seed classroom"}
                className="rounded-full bg-foreground px-5 py-2.5 text-[13px] font-medium text-background transition-transform hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-55"
              >
                {submitting ? "Seeding..." : "Seed classroom"}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[820px] w-full border-collapse text-left text-[13px]">
                <thead className="border-b border-border text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Role</th>
                    <th className="py-2 pr-3 font-medium">Email</th>
                    <th className="py-2 pr-3 font-medium">Name</th>
                    <th className="py-2 pr-3 font-medium">Grade</th>
                    <th className="py-2 pr-3 font-medium">Password override</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.rowId} className="border-b border-border/60">
                      <td className="py-2 pr-3">
                        <select
                          value={row.role}
                          onChange={(event) =>
                            updateRow(row.rowId, { role: event.target.value as PilotRole })
                          }
                          className="jargon-input min-w-[110px]"
                        >
                          <option value="student">student</option>
                          <option value="teacher">teacher</option>
                        </select>
                      </td>
                      <td className="py-2 pr-3">
                        <div className="space-y-1">
                          <input
                            value={row.email}
                            onChange={(event) =>
                              updateRow(row.rowId, { email: event.target.value })
                            }
                            className={`jargon-input min-w-[220px] ${
                              emailErrors[row.rowId] ? "border-red-500/60" : ""
                            }`}
                          />
                          {emailErrors[row.rowId] ? (
                            <div className="text-[11px] text-red-500">{emailErrors[row.rowId]}</div>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <div className="space-y-1">
                          <input
                            value={row.name}
                            onChange={(event) => updateRow(row.rowId, { name: event.target.value })}
                            className={`jargon-input min-w-[180px] ${
                              nameErrors[row.rowId] ? "border-red-500/60" : ""
                            }`}
                          />
                          {nameErrors[row.rowId] ? (
                            <div className="text-[11px] text-red-500">{nameErrors[row.rowId]}</div>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          value={row.grade || ""}
                          onChange={(event) => updateRow(row.rowId, { grade: event.target.value })}
                          className="jargon-input min-w-[120px]"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <div className="space-y-1">
                          <input
                            type="password"
                            value={row.password || ""}
                            onChange={(event) =>
                              updateRow(row.rowId, { password: event.target.value })
                            }
                            className={`jargon-input min-w-[180px] ${
                              passwordErrors[row.rowId] ? "border-red-500/60" : ""
                            }`}
                          />
                          {passwordErrors[row.rowId] ? (
                            <div className="text-[11px] text-red-500">
                              {passwordErrors[row.rowId]}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          onClick={() => removeRow(row.rowId)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          aria-label="Remove roster row"
                        >
                          <Trash2 className="h-4 w-4" strokeWidth={1.6} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </GradientCard>

        {(message || results.length > 0) && (
          <GradientCard>
            <div className="space-y-4 p-5">
              {message && (
                <div className="flex items-start gap-2 text-[13px] text-muted-foreground">
                  {results.some((result) => result.status === "failed") ? (
                    <AlertCircle
                      className="mt-0.5 h-4 w-4 shrink-0 text-red-500"
                      strokeWidth={1.7}
                    />
                  ) : (
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500"
                      strokeWidth={1.7}
                    />
                  )}
                  <span>
                    {message}
                    {batchId ? (
                      <span className="ml-2 text-muted-foreground/70">Batch {batchId}</span>
                    ) : null}
                  </span>
                </div>
              )}
              {results.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="min-w-[680px] w-full border-collapse text-left text-[13px]">
                    <thead className="border-b border-border text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                      <tr>
                        <th className="py-2 pr-3 font-medium">Status</th>
                        <th className="py-2 pr-3 font-medium">Role</th>
                        <th className="py-2 pr-3 font-medium">Email</th>
                        <th className="py-2 font-medium">Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((result) => (
                        <tr
                          key={`${result.email}-${result.role}`}
                          className="border-b border-border/60"
                        >
                          <td className={`py-2 pr-3 font-medium ${resultTone(result.status)}`}>
                            {result.status}
                          </td>
                          <td className="py-2 pr-3 text-muted-foreground">{result.role}</td>
                          <td className="py-2 pr-3 text-foreground">{result.email}</td>
                          <td className="py-2 text-muted-foreground">
                            {result.error || result.user_id || ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </GradientCard>
        )}
      </main>
    </AdminShell>
  );
}

function AdminShell({
  email,
  message,
  children,
}: {
  email: string;
  message?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="relative flex min-h-screen flex-col overflow-hidden"
      style={{ background: "var(--background)" }}
    >
      <AmbientCanvas intensity={0.28} />
      <header
        className="relative z-20 shrink-0 backdrop-blur-md"
        style={{ background: "color-mix(in oklab, var(--background) 72%, transparent)" }}
      >
        <div className="hairline">
          <div className="mx-auto flex h-[60px] max-w-[1200px] items-center justify-between gap-2 px-3 sm:px-6">
            <Link to="/chat" className="font-serif text-[22px] tracking-tight text-foreground">
              Jargon
            </Link>
            {email ? <SettingsMenu email={email} /> : null}
          </div>
        </div>
      </header>
      {children || (
        <main className="relative z-10 mx-auto flex w-full max-w-[760px] flex-1 flex-col items-center justify-center px-5 text-center">
          <div className="text-[14px] text-muted-foreground">{message}</div>
        </main>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
