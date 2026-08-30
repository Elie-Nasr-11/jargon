import { Suspense, lazy } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RouteLoader } from "@/components/RouteLoader";

// R82: the admin window loads on demand — most sessions never open it, and it used
// to ride in the one chunk every teacher and student downloaded before first paint.
const AdminPage = lazy(() =>
  import("@/features/admin/AdminPage").then((module) => ({ default: module.AdminPage })),
);

export function validateAdminSearch(search: Record<string, unknown>): Record<string, unknown> & {
  org?: string;
  tab?: string;
} {
  return {
    ...search,
    org: typeof search.org === "string" ? search.org : undefined,
    tab: typeof search.tab === "string" ? search.tab : undefined,
  };
}

export const Route = createFileRoute("/admin")({
  validateSearch: validateAdminSearch,
  head: () => ({
    meta: [
      { title: "Pilot Admin - Jargon" },
      { name: "description", content: "Seed pilot classrooms for Jargon." },
    ],
  }),
  component: AdminRoute,
});

function AdminRoute() {
  return (
    <Suspense fallback={<RouteLoader />}>
      <AdminPage />
    </Suspense>
  );
}
