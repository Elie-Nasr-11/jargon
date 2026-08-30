/**
 * People · Import a roster — the only place accounts are created.
 *
 * Rebuild brief, step 7. This was the middle third of the "Seeding" tab, a
 * database word bundling three unrelated jobs: demo logins, organization + class
 * creation, and roster import. The brief's complaint is precise — "students arrive
 * through three different doors that do subtly different things (one creates
 * accounts, two only link existing ones)" — so the door that creates accounts now
 * stands in People, where an admin looking for a person will find it.
 *
 * The one real change on the way: it targets a class that already EXISTS, chosen
 * from this organization's list, instead of asking for an organization name and a
 * class name. Typing a name that did not match created a second class silently,
 * which is how a pilot ended up with "Grade 7A" twice. Classes are created in
 * Classes; this screen fills one.
 */
import { useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { invokeAdminSeed } from "@/lib/api";
import type { AdminScope, AdminSeedResult, AdminSeedUser, PilotRole } from "@/lib/types";

type RosterRow = AdminSeedUser & { rowId: string };
import { orgClasses } from "./adminData";

const MIN_TEMP_PASSWORD_LENGTH = 6;

const blankRow = (): RosterRow => ({
  rowId: Math.random().toString(36).slice(2),
  email: "",
  name: "",
  role: "student",
  grade: "",
  password: "",
});

function normalizeRole(value: string): PilotRole {
  return value.trim().toLowerCase() === "teacher" ? "teacher" : "student";
}

function splitLine(line: string) {
  if (line.includes("\t")) return line.split("\t").map((part) => part.trim());
  return line.split(",").map((part) => part.trim());
}

export function parseRosterPaste(value: string): RosterRow[] {
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
  if (status === "created") return "text-success";
  if (status === "reused" || status === "skipped") return "text-info";
  return "text-danger";
}

export function RosterImport({
  token,
  scope,
  organizationId,
  onSeeded,
}: {
  token: string;
  scope: AdminScope;
  organizationId: string;
  onSeeded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [classId, setClassId] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [rows, setRows] = useState<RosterRow[]>([blankRow()]);
  const [defaultPassword, setDefaultPassword] = useState("");
  const [results, setResults] = useState<AdminSeedResult[]>([]);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const classes = useMemo(
    () => orgClasses(scope, organizationId).filter((item) => item.status === "active"),
    [scope, organizationId],
  );
  const organization = useMemo(
    () => scope.organizations.find((item) => item.id === organizationId) || null,
    [scope, organizationId],
  );
  const target = classes.find((item) => item.id === classId) || null;

  const validRows = useMemo(
    () => rows.filter((row) => row.email.trim() || row.name.trim()),
    [rows],
  );
  const hasDefaultPassword = defaultPassword.trim().length >= MIN_TEMP_PASSWORD_LENGTH;

  const errors = useMemo(() => {
    const list: string[] = [];
    if (!target) list.push("Choose the class these people join.");
    if (!validRows.length) list.push("Add at least one teacher or student.");
    if (validRows.some((row) => !/^\S+@\S+\.\S+$/.test(row.email.trim())))
      list.push("Every row needs a valid email address.");
    if (validRows.some((row) => !row.name.trim())) list.push("Every row needs a name.");
    if (
      validRows.some(
        (row) =>
          !hasDefaultPassword && (row.password ?? "").trim().length < MIN_TEMP_PASSWORD_LENGTH,
      )
    ) {
      list.push(
        `Set a default temporary password of at least ${MIN_TEMP_PASSWORD_LENGTH} characters, or give every row its own.`,
      );
    }
    return list;
  }, [target, validRows, hasDefaultPassword]);

  const applyPaste = () => {
    const parsed = parseRosterPaste(pasteText);
    if (!parsed.length) {
      setMessage("Nothing to read in that paste.");
      return;
    }
    setRows(parsed);
    setMessage(`Read ${parsed.length} row${parsed.length === 1 ? "" : "s"}.`);
  };

  const updateRow = (rowId: string, patch: Partial<RosterRow>) =>
    setRows((current) => current.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)));
  const removeRow = (rowId: string) =>
    setRows((current) => {
      const next = current.filter((row) => row.rowId !== rowId);
      return next.length ? next : [blankRow()];
    });

  const submit = async () => {
    if (submitting || !token || !target || !organization) return;
    if (errors.length) {
      setMessage(errors[0]);
      return;
    }
    setSubmitting(true);
    setMessage("");
    setResults([]);
    try {
      // Both ids are EXISTING rows, so admin-seed reuses them rather than creating
      // an organization or a class as a side effect of importing people.
      const response = await invokeAdminSeed({
        accessToken: token,
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
        },
        class: { id: target.id, name: target.name },
        defaultPassword: defaultPassword.trim(),
        users: validRows.map(({ rowId: _rowId, ...row }) => row),
      });
      setResults(response.results);
      setMessage(
        response.results.some((result) => result.status === "failed")
          ? "Import finished with errors."
          : "Import finished.",
      );
      onSeeded();
    } catch (error) {
      setMessage((error as Error).message || "Could not import that roster.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn btn-secondary btn-sm">
        <Upload className="h-3.5 w-3.5" strokeWidth={1.8} />
        Import a roster
      </button>
    );
  }

  return (
    <section className="rounded-card border border-border bg-depth-card shadow-card">
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-title font-medium text-foreground">Import a roster</h2>
            <p className="mt-1 max-w-2xl text-meta leading-relaxed text-muted-foreground">
              Creates accounts for people who do not have one and adds everybody to the class you
              choose. Anyone who already has an account keeps it — they are reused, never
              duplicated.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="btn btn-secondary btn-sm shrink-0"
          >
            Close
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Class they join
            <select
              value={classId}
              onChange={(event) => setClassId(event.target.value)}
              className="jargon-input normal-case tracking-normal"
            >
              <option value="">Choose a class…</option>
              {classes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Default temporary password
            <input
              value={defaultPassword}
              onChange={(event) => setDefaultPassword(event.target.value)}
              placeholder={`At least ${MIN_TEMP_PASSWORD_LENGTH} characters`}
              className="jargon-input normal-case tracking-normal"
            />
          </label>
        </div>
        {classes.length === 0 ? (
          <p className="text-meta text-muted-foreground">
            This organization has no active classes yet — create one in Classes first.
          </p>
        ) : null}

        <div className="grid gap-2">
          <label className="text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Paste rows
          </label>
          <p className="text-meta text-muted-foreground">
            CSV or tab-separated. Header fields can be email, name, role, grade, password — or paste
            bare rows in that order.
          </p>
          <textarea
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            rows={4}
            placeholder="email,name,role,grade&#10;lina@school.edu,Lina Haddad,student,7"
            className="jargon-input min-h-[96px] font-mono text-meta"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={applyPaste} className="btn btn-secondary btn-sm">
              Read the paste
            </button>
            <button
              type="button"
              onClick={() => setRows((current) => [...current, blankRow()])}
              className="btn btn-secondary btn-sm"
            >
              Add a row
            </button>
          </div>
        </div>

        <div className="table-scroll">
          <table className="w-full min-w-[640px] text-left">
            <thead className="border-b border-border text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
              <tr>
                <th className="py-2 pr-3">Email</th>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">Grade</th>
                <th className="py-2 pr-3">Password</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.rowId} className="border-b border-border/60 last:border-0">
                  <td className="py-1.5 pr-3">
                    <input
                      value={row.email}
                      onChange={(event) =>
                        updateRow(row.rowId, { email: event.target.value.toLowerCase() })
                      }
                      aria-label="Email"
                      className="jargon-input w-full"
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <input
                      value={row.name}
                      onChange={(event) => updateRow(row.rowId, { name: event.target.value })}
                      aria-label="Name"
                      className="jargon-input w-full"
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <select
                      value={row.role}
                      onChange={(event) =>
                        updateRow(row.rowId, { role: normalizeRole(event.target.value) })
                      }
                      aria-label="Role"
                      className="jargon-input w-full"
                    >
                      <option value="student">student</option>
                      <option value="teacher">teacher</option>
                    </select>
                  </td>
                  <td className="py-1.5 pr-3">
                    <input
                      value={row.grade}
                      onChange={(event) => updateRow(row.rowId, { grade: event.target.value })}
                      aria-label="Grade"
                      className="jargon-input w-full"
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <input
                      value={row.password}
                      onChange={(event) => updateRow(row.rowId, { password: event.target.value })}
                      aria-label="Temporary password"
                      placeholder={hasDefaultPassword ? "default" : "required"}
                      className="jargon-input w-full"
                    />
                  </td>
                  <td className="py-1.5">
                    <button
                      type="button"
                      onClick={() => removeRow(row.rowId)}
                      className="btn btn-secondary btn-sm"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {errors.length ? (
          <ul className="grid gap-0.5">
            {errors.map((error) => (
              <li key={error} className="text-meta text-danger">
                {error}
              </li>
            ))}
          </ul>
        ) : null}
        {message ? <p className="text-meta text-muted-foreground">{message}</p> : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || errors.length > 0}
            className="btn btn-primary btn-sm"
          >
            {submitting
              ? "Importing…"
              : `Import ${validRows.length || ""} into ${target?.name ?? "…"}`.trim()}
          </button>
        </div>

        {results.length ? (
          <div className="table-scroll">
            <table className="w-full min-w-[420px] text-left">
              <thead className="border-b border-border text-overline font-medium uppercase tracking-[0.1em] text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3">Email</th>
                  <th className="py-2 pr-3">Role</th>
                  <th className="py-2 pr-3">Result</th>
                  <th className="py-2">Detail</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr key={result.email} className="border-b border-border/60 last:border-0">
                    <td className="py-1.5 pr-3 text-meta text-foreground">{result.email}</td>
                    <td className="py-1.5 pr-3 text-meta text-muted-foreground">{result.role}</td>
                    <td className={`py-1.5 pr-3 text-meta ${resultTone(result.status)}`}>
                      {result.status}
                    </td>
                    <td className="py-1.5 text-meta text-muted-foreground">
                      {result.error || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}
