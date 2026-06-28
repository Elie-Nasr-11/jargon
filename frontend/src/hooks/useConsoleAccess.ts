// The signed-in user's single effective portal. Precedence: admin > teacher >
// student. Used to role-gate the header nav so a user only ever sees their own
// portal. Cached via React Query (one resolve/session).
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPrimaryRole, getSession, roleHome } from "@/lib/api";
import type { PrimaryRole } from "@/lib/api";

export type ConsoleAccess = {
  role: PrimaryRole | null;
  home: "/chat" | "/teacher" | "/admin" | "/platform" | null;
  student: boolean;
  teacher: boolean;
  admin: boolean;
  platformAdmin: boolean;
  orgAdmin: boolean;
  loading: boolean;
};

export function useConsoleAccess(): ConsoleAccess {
  const [auth, setAuth] = useState<{ id: string; token: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void getSession().then((session) => {
      if (alive && session) setAuth({ id: session.user.id, token: session.access_token });
    });
    return () => {
      alive = false;
    };
  }, []);

  const query = useQuery({
    queryKey: ["consoleRole", auth?.id],
    enabled: Boolean(auth),
    staleTime: 5 * 60 * 1000,
    queryFn: (): Promise<PrimaryRole> => fetchPrimaryRole(auth!.token, auth!.id),
  });

  const role = query.data ?? null;
  return {
    role,
    home: role ? roleHome(role) : null,
    student: role === "student",
    teacher: role === "teacher",
    admin: role === "platform_admin" || role === "org_admin",
    platformAdmin: role === "platform_admin",
    orgAdmin: role === "org_admin",
    loading: Boolean(auth) && query.isPending,
  };
}
