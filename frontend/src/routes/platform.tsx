import { Suspense, lazy } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RouteLoader } from "@/components/RouteLoader";
import { validateAdminSearch } from "@/routes/admin";

const AdminPage = lazy(() =>
  import("@/features/admin/AdminPage").then((module) => ({ default: module.AdminPage })),
);

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
  component: PlatformRoute,
});

function PlatformRoute() {
  return (
    <Suspense fallback={<RouteLoader />}>
      <AdminPage />
    </Suspense>
  );
}
