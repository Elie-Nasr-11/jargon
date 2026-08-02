import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  changeOwnPassword,
  fetchProfile,
  fetchStudentClasses,
  fetchStudentGrades,
  getSession,
  sendPasswordReset,
  updateOwnProfile,
} from "@/lib/api";
import { formatScore } from "@/lib/format";
import { ClassAvatar } from "@/student/ClassList";
import { SectionLabel, StatPill } from "@/student/summaryBits";
import type { StudentClass, StudentGradeRow } from "@/lib/types";

// The student's Profile panel (round 11): who you are, your account, and your classes at
// a glance. Everything here edits the student's OWN rows under owner RLS — grade stays
// read-only (the school sets it). The standing mentor note (MentorNoteCard, exported
// below) mounts on the CUSTOMIZE surface instead: it shapes HOW the mentor teaches, and
// stays style-only by the server's STUDENT INSTRUCTIONS guardrail.

const FIELD =
  "w-full rounded-control border border-border bg-depth-field px-3 py-2 text-body text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground/40";
const SAVE_BUTTON =
  "rounded-control border border-border px-3 py-1.5 text-meta font-semibold text-foreground transition-colors duration-(--dur-fast) hover:bg-muted disabled:opacity-50";

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-border bg-depth-card p-4 shadow-card">
      {children}
    </div>
  );
}

type SaveState = "idle" | "busy" | "done" | "error";

function saveLabel(state: SaveState, idle = "Save"): string {
  return state === "busy" ? "Saving…" : state === "done" ? "Saved" : idle;
}

export function ProfilePanel() {
  const [email, setEmail] = useState("");
  const [grade, setGrade] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Identity drafts (editable copies of the profile row). The mentor note lives on the
  // CUSTOMIZE surface (MentorNoteCard below) with the rest of the mentor-shaping controls.
  const [fullName, setFullName] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [identityState, setIdentityState] = useState<SaveState>("idle");

  // Account.
  const [password, setPassword] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const [passwordState, setPasswordState] = useState<SaveState>("idle");
  const [passwordError, setPasswordError] = useState("");
  const [resetState, setResetState] = useState<SaveState>("idle");

  // Classes + performance.
  const [classes, setClasses] = useState<StudentClass[] | null>(null);
  const [grades, setGrades] = useState<StudentGradeRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getSession()
      .then(async (session) => {
        const userId = session?.user?.id;
        if (!userId) return;
        if (!cancelled) setEmail(session?.user?.email ?? "");
        const profile = await fetchProfile(userId).catch(() => null);
        if (cancelled) return;
        setFullName(profile?.name ?? "");
        setPreferredName(profile?.preferred_name ?? "");
        setGrade(profile?.grade ?? null);
        setLoaded(true);
      })
      .catch(() => !cancelled && setLoaded(true));
    void fetchStudentClasses()
      .then((rows) => !cancelled && setClasses(rows))
      .catch(() => !cancelled && setClasses([]));
    void fetchStudentGrades()
      .then((rows) => !cancelled && setGrades(rows))
      .catch(() => !cancelled && setGrades([]));
    return () => {
      cancelled = true;
    };
  }, []);

  // Per-class performance from released grades: average + graded count.
  const performance = useMemo(() => {
    const byClass = new Map<string, { sum: number; count: number }>();
    for (const row of grades ?? []) {
      if (row.score === null || !row.class_id) continue;
      const entry = byClass.get(row.class_id) ?? { sum: 0, count: 0 };
      entry.sum += row.score;
      entry.count += 1;
      byClass.set(row.class_id, entry);
    }
    return byClass;
  }, [grades]);

  const save = (
    patch: Parameters<typeof updateOwnProfile>[0],
    setState: (s: SaveState) => void,
  ) => {
    setState("busy");
    void updateOwnProfile(patch)
      .then(() => setState("done"))
      .catch(() => setState("error"));
  };

  const changePassword = () => {
    setPasswordError("");
    if (password.length < 8) {
      setPasswordError("Use at least 8 characters.");
      return;
    }
    if (password !== passwordAgain) {
      setPasswordError("The two passwords don't match.");
      return;
    }
    setPasswordState("busy");
    void changeOwnPassword(password)
      .then(() => {
        setPasswordState("done");
        setPassword("");
        setPasswordAgain("");
      })
      .catch((err: unknown) => {
        setPasswordState("error");
        setPasswordError(err instanceof Error ? err.message : "Password change failed.");
      });
  };

  if (!loaded) {
    return (
      <p className="flex items-center gap-2 text-meta text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
      </p>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 pb-8">
      {/* ---- Identity ---------------------------------------------------------------- */}
      <section>
        <SectionLabel>Identity</SectionLabel>
        <Card>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-meta text-muted-foreground">Preferred name</span>
              <input
                className={FIELD}
                value={preferredName}
                maxLength={60}
                placeholder="What your mentor calls you"
                onChange={(e) => {
                  setPreferredName(e.target.value);
                  setIdentityState("idle");
                }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-meta text-muted-foreground">Full name</span>
              <input
                className={FIELD}
                value={fullName}
                maxLength={120}
                onChange={(e) => {
                  setFullName(e.target.value);
                  setIdentityState("idle");
                }}
              />
            </label>
          </div>
          <div className="mt-3 flex items-center gap-2">
            {grade ? <StatPill ariaLabel={`Grade ${grade}`}>GRADE {grade}</StatPill> : null}
            <span className="flex-1 text-meta text-muted-foreground">
              {grade ? "Your school sets your grade level." : ""}
            </span>
            <button
              type="button"
              disabled={identityState === "busy"}
              onClick={() =>
                save(
                  {
                    name: fullName.trim() || null,
                    preferred_name: preferredName.trim() || null,
                  },
                  setIdentityState,
                )
              }
              className={SAVE_BUTTON}
            >
              {saveLabel(identityState)}
            </button>
          </div>
        </Card>
      </section>

      {/* ---- Account ------------------------------------------------------------------ */}
      <section>
        <SectionLabel>Account</SectionLabel>
        <Card>
          <div className="mb-3 flex items-baseline gap-2">
            <span className="text-meta text-muted-foreground">Email</span>
            <span className="min-w-0 flex-1 truncate text-body text-foreground">{email}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-meta text-muted-foreground">New password</span>
              <input
                className={FIELD}
                type="password"
                value={password}
                autoComplete="new-password"
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordState("idle");
                }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-meta text-muted-foreground">Repeat it</span>
              <input
                className={FIELD}
                type="password"
                value={passwordAgain}
                autoComplete="new-password"
                onChange={(e) => {
                  setPasswordAgain(e.target.value);
                  setPasswordState("idle");
                }}
              />
            </label>
          </div>
          {passwordError ? <p className="mt-2 text-meta text-danger">{passwordError}</p> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={passwordState === "busy" || !password}
              onClick={changePassword}
              className={SAVE_BUTTON}
            >
              {saveLabel(passwordState, "Update password")}
            </button>
            <span className="flex-1" />
            <button
              type="button"
              disabled={resetState === "busy" || resetState === "done"}
              onClick={() => {
                setResetState("busy");
                void sendPasswordReset()
                  .then(() => setResetState("done"))
                  .catch(() => setResetState("error"));
              }}
              className="rounded-control px-2.5 py-1.5 text-meta text-muted-foreground transition-colors duration-(--dur-fast) hover:bg-muted hover:text-foreground disabled:opacity-60"
            >
              {resetState === "done"
                ? "Reset email sent"
                : resetState === "busy"
                  ? "Sending…"
                  : "Email me a reset link"}
            </button>
          </div>
        </Card>
      </section>

      {/* ---- Classes & performance ---------------------------------------------------- */}
      <section>
        <SectionLabel>Classes &amp; performance</SectionLabel>
        <Card>
          {classes === null || grades === null ? (
            <p className="flex items-center gap-2 text-meta text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </p>
          ) : classes.length ? (
            <ul className="flex flex-col">
              {classes.map((klass) => {
                const perf = performance.get(klass.id);
                return (
                  <li
                    key={klass.id}
                    className="hvp flex items-center gap-2.5 border-b border-border py-2 last:border-0"
                  >
                    <ClassAvatar name={klass.name} size={7} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-foreground">{klass.name}</span>
                      {klass.organizationName ? (
                        <span className="hvr block truncate text-overline text-muted-foreground">
                          {klass.organizationName}
                        </span>
                      ) : null}
                    </span>
                    {perf ? (
                      <>
                        <span className="hvr shrink-0 text-meta text-muted-foreground">
                          {perf.count} graded
                        </span>
                        <span className="shrink-0 font-mono text-meta font-semibold tabular-nums text-foreground">
                          AVG {formatScore(perf.sum / perf.count)}
                        </span>
                      </>
                    ) : (
                      <span className="shrink-0 text-meta text-muted-foreground">
                        No grades yet
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-body text-muted-foreground">You're not in any classes yet.</p>
          )}
        </Card>
      </section>
    </div>
  );
}

// The student's standing note to their mentor — mounted on the CUSTOMIZE surface (it
// shapes HOW the mentor teaches, so it lives with tone/pace/voice, not with account
// info). Self-contained: loads and saves its own profile column.
export function MentorNoteCard() {
  const [instructions, setInstructions] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [noteState, setNoteState] = useState<SaveState>("idle");

  useEffect(() => {
    let cancelled = false;
    void getSession()
      .then(async (session) => {
        const userId = session?.user?.id;
        if (!userId) return;
        const profile = await fetchProfile(userId).catch(() => null);
        if (cancelled) return;
        setInstructions(profile?.mentor_instructions ?? "");
        setLoaded(true);
      })
      .catch(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="mt-6">
      <SectionLabel>Note to your mentor</SectionLabel>
      <Card>
        {!loaded ? (
          <p className="flex items-center gap-2 text-meta text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </p>
        ) : (
          <>
            <textarea
              className={`${FIELD} min-h-[88px] resize-none`}
              value={instructions}
              maxLength={500}
              placeholder='Standing instructions for how you like to learn — "use soccer examples", "let me try before hints"…'
              onChange={(e) => {
                setInstructions(e.target.value);
                setNoteState("idle");
              }}
            />
            <div className="mt-2 flex items-center gap-2">
              <span className="flex-1 text-meta text-muted-foreground">
                Style only — your mentor keeps its teaching rules.{" "}
                <span className="font-mono tabular-nums">{instructions.length}/500</span>
              </span>
              <button
                type="button"
                disabled={noteState === "busy"}
                onClick={() => {
                  setNoteState("busy");
                  void updateOwnProfile({ mentor_instructions: instructions.trim() || null })
                    .then(() => setNoteState("done"))
                    .catch(() => setNoteState("error"));
                }}
                className={SAVE_BUTTON}
              >
                {saveLabel(noteState)}
              </button>
            </div>
          </>
        )}
      </Card>
    </section>
  );
}
