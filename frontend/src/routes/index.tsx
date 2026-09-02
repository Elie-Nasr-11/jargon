import { createFileRoute, redirect } from "@tanstack/react-router";
import { fetchPrimaryRole, getSession, roleHomeNav } from "@/lib/api";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    if (typeof window !== "undefined") {
      const session = await getSession();
      if (!session) throw redirect({ to: "/login" });
      // A redirect IS a thrown value here, so it must escape the try untouched. Only a
      // real failure to resolve the role — a network blip, a cold edge function — falls
      // through to /login, which is where a signed-out-looking user belongs. Without
      // this the entry route lands on the router's error boundary instead.
      let role;
      try {
        role = await fetchPrimaryRole(session.access_token, session.user.id);
      } catch {
        throw redirect({ to: "/login" });
      }
      throw redirect(roleHomeNav(role));
    }
    throw redirect({ to: "/login" });
  },
  component: () => null,
});
