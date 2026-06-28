// The signed-in user's org "Campus Live" link-out, if an admin configured one.
// Cached via React Query so the shared SettingsMenu can show it for students,
// teachers, and admins without each surface refetching.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCampusLiveLink, getSession } from "@/lib/api";

export function useCampusLiveLink(): string | null {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void getSession().then((session) => {
      if (alive && session) setUserId(session.user.id);
    });
    return () => {
      alive = false;
    };
  }, []);

  const query = useQuery({
    queryKey: ["campusLiveLink", userId],
    enabled: Boolean(userId),
    staleTime: 5 * 60 * 1000,
    queryFn: () => fetchCampusLiveLink(),
  });

  return query.data ?? null;
}
