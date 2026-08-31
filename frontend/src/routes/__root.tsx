import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Toaster } from "@/components/ui/sonner";
import { RouteLoader } from "@/components/RouteLoader";
import {
  fetchPrimaryRole,
  getSession,
  onAuthStateChange,
  recordClientError,
  roleHomeNav,
} from "../lib/api";
import { reportLovableError } from "../lib/lovable-error-reporting";

/**
 * R86: this is where a retired URL lands now.
 *
 * The rebuild deleted its old routes one release at a time, each leaving a redirect
 * behind; step 9 deletes the redirects too ("Not deprecate. Delete."). That makes
 * this screen the landing for every old bookmark and every link in an email sent
 * before the rebuild — so it does not sit there saying "Go home" and waiting for a
 * click. A signed-in person is sent to the home their role actually has; only
 * someone signed out is asked to do anything.
 */
function NotFoundComponent() {
  const navigate = useNavigate();
  const [stranded, setStranded] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const session = await getSession();
        if (!alive) return;
        if (!session) {
          navigate({ to: "/login", replace: true });
          return;
        }
        const role = await fetchPrimaryRole(session.access_token, session.user.id);
        if (!alive) return;
        navigate({ ...roleHomeNav(role), replace: true });
      } catch {
        // Could not tell who this is — show the page rather than bouncing them
        // somewhere they may not be allowed.
        if (alive) setStranded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [navigate]);

  if (!stranded) return <RouteLoader label="Taking you back…" />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="font-serif text-display text-foreground">That page has moved.</h1>
        <p className="mt-2 text-body text-muted-foreground">
          The link you followed points at a screen Jargon no longer has.
        </p>
        <div className="mt-6">
          <Link to="/" className="btn btn-primary">
            Take me to my classes
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
    // reportLovableError only reaches the Lovable preview sink; production crashes were
    // landing nowhere. Record to runtime_events so a tester's "something went wrong" is
    // diagnosable after the fact.
    void recordClientError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        {/* The real message, small but present: a screenshot of the generic line alone
            told us nothing, and this page is where testers land. */}
        {error?.message ? (
          <p className="mt-2 break-words text-xs text-muted-foreground/80">{error.message}</p>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // App-lifetime realtime-auth owner: onAuthStateChange re-sets supabase.realtime auth on every token
  // refresh (api.ts), so ANY realtime channel — the teacher live-view, the notification bell, and
  // future comms channels — survives past the first token's ~1h expiry. Mounting it here (above every
  // route) means new realtime surfaces don't each have to remember to keep the socket authenticated.
  useEffect(() => {
    const { data } = onAuthStateChange(() => {});
    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster richColors closeButton />
    </QueryClientProvider>
  );
}
