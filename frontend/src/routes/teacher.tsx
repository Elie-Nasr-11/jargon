import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BookOpen, UsersRound } from "lucide-react";
import { AmbientCanvas } from "@/components/AmbientCanvas";
import { GradientCard } from "@/components/GradientCard";
import { SettingsMenu } from "@/components/SettingsMenu";
import { fetchTeacherClasses, getSession } from "@/lib/api";
import type { TeacherClassSummary } from "@/lib/types";

export const Route = createFileRoute("/teacher")({
  head: () => ({
    meta: [
      { title: "Teacher - Jargon" },
      { name: "description", content: "Teacher classroom shell for Jargon." },
    ],
  }),
  component: TeacherPage,
});

function rosterCount(summary: TeacherClassSummary, role: "student" | "teacher") {
  return (summary.class_memberships || []).filter(
    (membership) => membership.role === role && membership.status === "active",
  ).length;
}

function organizationName(summary: TeacherClassSummary) {
  const organization = Array.isArray(summary.organizations)
    ? summary.organizations[0]
    : summary.organizations;
  return organization?.name || "Organization";
}

function TeacherPage() {
  const navigate = useNavigate();
  const [booting, setBooting] = useState(true);
  const [email, setEmail] = useState("");
  const [classes, setClasses] = useState<TeacherClassSummary[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const session = await getSession();
        if (!session) {
          navigate({ to: "/login", replace: true });
          return;
        }
        const classRows = await fetchTeacherClasses(session.user.id);
        if (!alive) return;
        setEmail(session.user.email || "");
        setClasses(classRows);
      } catch (error) {
        if (!alive) return;
        setMessage((error as Error).message || "Could not load teacher classes.");
      } finally {
        if (alive) setBooting(false);
      }
    };
    run();
    return () => {
      alive = false;
    };
  }, [navigate]);

  const totals = useMemo(
    () =>
      classes.reduce(
        (acc, item) => {
          acc.students += rosterCount(item, "student");
          acc.teachers += rosterCount(item, "teacher");
          return acc;
        },
        { students: 0, teachers: 0 },
      ),
    [classes],
  );

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

      <main className="relative z-10 mx-auto flex w-full max-w-[980px] flex-1 flex-col gap-5 px-5 py-8">
        <section>
          <div className="text-[12px] uppercase tracking-[0.12em] text-muted-foreground">
            Teacher shell
          </div>
          <h1 className="font-serif mt-2 text-[38px] leading-tight tracking-tight text-foreground">
            Your pilot classes.
          </h1>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
            This first teacher surface confirms seeded accounts, classes, and memberships. The full
            gradebook, transcript heatmap, assignments, and interventions come next.
          </p>
        </section>

        {booting ? (
          <GradientCard>
            <div className="p-6 text-[14px] text-muted-foreground">Loading teacher access...</div>
          </GradientCard>
        ) : message ? (
          <GradientCard>
            <div className="p-6 text-[14px] text-muted-foreground">{message}</div>
          </GradientCard>
        ) : null}

        {!booting && !message && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <MetricCard label="Classes" value={String(classes.length)} />
              <MetricCard label="Students" value={String(totals.students)} />
              <MetricCard label="Teachers" value={String(totals.teachers)} />
            </div>

            <GradientCard>
              <div className="p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-[16px] font-medium text-foreground">Assigned classes</h2>
                    <p className="mt-1 text-[12.5px] text-muted-foreground">
                      Roster counts come from live class memberships.
                    </p>
                  </div>
                  <Link
                    to="/chat"
                    className="rounded-full border border-border px-4 py-2 text-[13px] text-foreground transition-colors hover:bg-muted"
                  >
                    Open student chat
                  </Link>
                </div>

                {classes.length ? (
                  <div className="grid gap-3">
                    {classes.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-3xl border border-border bg-background/55 p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-[15px] font-medium text-foreground">
                              {item.name}
                            </div>
                            <div className="mt-1 text-[12.5px] text-muted-foreground">
                              {organizationName(item)} · {item.status}
                            </div>
                          </div>
                          <div className="flex gap-3 text-[12px] text-muted-foreground">
                            <span className="inline-flex items-center gap-1.5">
                              <UsersRound className="h-3.5 w-3.5" strokeWidth={1.6} />
                              {rosterCount(item, "student")} students
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <BookOpen className="h-3.5 w-3.5" strokeWidth={1.6} />
                              {rosterCount(item, "teacher")} teachers
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-3xl border border-border bg-background/55 p-6 text-[14px] text-muted-foreground">
                    No teacher class memberships yet. Seed a teacher through the platform admin
                    screen, then sign back in with that teacher account.
                  </div>
                )}
              </div>
            </GradientCard>
          </>
        )}
      </main>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <GradientCard>
      <div className="p-5">
        <div className="text-[12px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
        <div className="mt-2 font-serif text-[34px] leading-none text-foreground">{value}</div>
      </div>
    </GradientCard>
  );
}
