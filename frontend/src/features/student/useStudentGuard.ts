import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { fetchPrimaryRole, getSession, roleHome } from "@/lib/api";

// v4.0 Phase 3b — gate a student-only route. Redirects to /login when signed out, or to the
// caller's own role home when they aren't a student. Mirrors the chat.tsx bootstrap guard so the
// class views enforce the same access rule as the chat surface.
export function useStudentGuard(): { ready: boolean } {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const session = await getSession();
        if (!session) {
          navigate({ to: "/login", replace: true });
          return;
        }
        const role = await fetchPrimaryRole(session.access_token, session.user.id);
        if (!alive) return;
        if (role !== "student") {
          navigate({ to: roleHome(role), replace: true });
          return;
        }
        setReady(true);
      } catch {
        if (alive) navigate({ to: "/login", replace: true });
      }
    })();
    return () => {
      alive = false;
    };
  }, [navigate]);
  return { ready };
}
