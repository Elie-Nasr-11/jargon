import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getSession, signOut } from "@/lib/api";
import { StudentApp } from "@/student/StudentApp";
import {
  isDestination,
  isSection,
  type StudentDestination,
  type StudentSection,
} from "@/student/navigation";

// The v6 student surface — the ONLY student surface (the old /chat route retired at trunk
// unification; roleHome sends students here).
//
// Nav state lives in the URL (?section=home&to=classes) so back/forward, refresh, and deep
// links all work — the same contract the previous surface depended on.
export const Route = createFileRoute("/learn")({
  component: LearnRoute,
  validateSearch: (
    search: Record<string, unknown>,
  ): { section?: StudentSection; to?: StudentDestination; class?: string } => ({
    section: isSection(search.section) ? search.section : undefined,
    to: isDestination(search.to) ? search.to : undefined,
    // The selected class. Any string passes — an unknown id degrades to the default class
    // in the shell rather than 404ing a shared link.
    class: typeof search.class === "string" && search.class ? search.class : undefined,
  }),
});

function LearnRoute() {
  const navigate = useNavigate();
  const { section, to, class: classId } = Route.useSearch();
  const [email, setEmail] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getSession()
      .then((session) => {
        if (cancelled) return;
        const address = session?.user?.email;
        if (address) setEmail(address);
      })
      .catch(() => {
        // A missing session is not fatal to the shell — the account row simply renders empty
        // rather than blocking the whole surface behind an error.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Absent section = Learn, matching "the conversation is the default" from the old surface.
  const activeSection: StudentSection = section ?? "learn";

  const go = (next: { section?: StudentSection; to?: StudentDestination; class?: string }) => {
    void navigate({ to: "/learn", search: next, replace: false });
  };

  return (
    <StudentApp
      email={email}
      section={activeSection}
      destination={to}
      classId={classId}
      // Section switches KEEP the selected class — the class is the student's working
      // context, not a per-section detail. Home with a class = that class's summary page.
      onSelectSection={(nextSection) => go({ section: nextSection, class: classId })}
      onSelectClass={(nextClassId) =>
        go({ section: activeSection, class: nextClassId ?? undefined })
      }
      onSelectDestination={(destination) =>
        go({ section: activeSection, to: destination, class: classId })
      }
      onCloseDestination={() => go({ section: activeSection, class: classId })}
      onSelectMenuItem={(item) => {
        // Every menu item does something real (MVP bar: no dead nav). Profile's stats live
        // in Reports; Customize opens the mentor controls; sign-out clears the session.
        if (item === "profile") go({ section: activeSection, to: "profile", class: classId });
        else if (item === "customize")
          go({ section: activeSection, to: "customize", class: classId });
        else if (item === "sign-out") {
          void signOut()
            .catch(() => {
              // A failed server-side sign-out still leaves for /login; the auth listener
              // clears local state either way.
            })
            .finally(() => void navigate({ to: "/login" }));
        }
      }}
    />
  );
}
