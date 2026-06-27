// Which consoles the signed-in user may access. Used to role-gate the nav so a
// student never sees Teacher/Admin. Cached via React Query (one resolve/session).
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAdminScope, fetchTeacherClasses, getSession } from "@/lib/api";

export type ConsoleAccess = {
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
    queryKey: ["consoleAccess", auth?.id],
    enabled: Boolean(auth),
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [classes, isAdmin] = await Promise.all([
        fetchTeacherClasses(auth!.id).catch(() => [] as unknown[]),
        fetchAdminScope(auth!.token)
          .then(() => true)
          .catch(() => false),
      ]);
      return { teacher: Array.isArray(classes) && classes.length > 0, admin: isAdmin };
    },
  });

  return {
    student: Boolean(auth),
    teacher: Boolean(query.data?.teacher),
    admin: Boolean(query.data?.admin),
    loading: Boolean(auth) && query.isPending,
  };
}
