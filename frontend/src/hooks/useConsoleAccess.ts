// The signed-in user's single effective portal. Precedence: admin > teacher >
// student. Used to role-gate the header nav so a user only ever sees their own
// portal. Cached via React Query (one resolve/session).
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAdminScope, fetchTeacherClasses, getSession, roleHome } from "@/lib/api";
import type { PrimaryRole } from "@/lib/api";

export type ConsoleAccess = {
  role: PrimaryRole | null;
  home: "/chat" | "/teacher" | "/admin" | null;
  student: boolean;
  teacher: boolean;
  admin: boolean;
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
    queryFn: async (): Promise<PrimaryRole> => {
      const isAdmin = await fetchAdminScope(auth!.token)
        .then(() => true)
        .catch(() => false);
      if (isAdmin) return "admin";
      const classes = await fetchTeacherClasses(auth!.id).catch(() => [] as unknown[]);
      if (Array.isArray(classes) && classes.length > 0) return "teacher";
      return "student";
    },
  });

  const role = query.data ?? null;
  return {
    role,
    home: role ? roleHome(role) : null,
    student: role === "student",
    teacher: role === "teacher",
    admin: role === "admin",
    loading: Boolean(auth) && query.isPending,
  };
}
