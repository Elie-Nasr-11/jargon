import { createFileRoute } from "@tanstack/react-router";
import { AdminPage, validateAdminSearch } from "@/routes/admin";

// The platform-admin portal. Renders the same admin screen as /admin, but the
// screen keys its level off the signed-in account (platform admins land here;
// org admins are redirected to /admin) and targets /platform for in-portal nav.
export const Route = createFileRoute("/platform")({
  validateSearch: validateAdminSearch,
  head: () => ({
    meta: [
      { title: "Platform Admin - Jargon" },
      { name: "description", content: "Platform-wide administration for Jargon." },
    ],
  }),
  component: AdminPage,
});
