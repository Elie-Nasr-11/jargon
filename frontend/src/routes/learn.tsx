import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getSession } from "@/lib/api";
import { StudentApp } from "@/student/StudentApp";
import {
  isDestination,
  isSection,
  type StudentDestination,
  type StudentSection,
} from "@/student/navigation";

// The v6 student surface. Lives alongside the existing /chat route while it's built out;
// /chat stays the shipping surface until this one is better, then /chat redirects here.
//
// Nav state lives in the URL (?section=home&to=classes) so back/forward, refresh, and deep
// links all work — the same contract the previous surface depended on.
export const Route = createFileRoute("/learn")({
  component: LearnRoute,
  validateSearch: (
    search: Record<string, unknown>,
  ): { section?: StudentSection; to?: StudentDestination } => ({
    section: isSection(search.section) ? search.section : undefined,
    to: isDestination(search.to) ? search.to : undefined,
  }),
});

function LearnRoute() {
  const navigate = useNavigate();
  const { section, to } = Route.useSearch();
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

  const go = (next: { section?: StudentSection; to?: StudentDestination }) => {
    void navigate({ to: "/learn", search: next, replace: false });
  };

  return (
    <StudentApp
      email={email}
      section={activeSection}
      destination={to}
      notificationsUnread={0}
      onSelectSection={(nextSection) => go({ section: nextSection })}
      onSelectDestination={(destination) => go({ section: activeSection, to: destination })}
      onCloseDestination={() => go({ section: activeSection })}
      onNewConversation={() => go({ section: "learn" })}
      onSelectMenuItem={() => {
        /* menu destinations arrive with their surfaces */
      }}
    />
  );
}
