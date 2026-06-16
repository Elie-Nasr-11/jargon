import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSession } from "@/lib/api";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    if (typeof window !== "undefined") {
      const session = await getSession();
      throw redirect({ to: session ? "/chat" : "/login" });
    }
    throw redirect({ to: "/login" });
  },
  component: () => null,
});
