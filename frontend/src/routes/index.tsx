import { createFileRoute, redirect } from "@tanstack/react-router";
import { fetchPrimaryRole, getSession, roleHome } from "@/lib/api";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    if (typeof window !== "undefined") {
      const session = await getSession();
      if (!session) throw redirect({ to: "/login" });
      const role = await fetchPrimaryRole(session.access_token, session.user.id);
      throw redirect({ to: roleHome(role) });
    }
    throw redirect({ to: "/login" });
  },
  component: () => null,
});
