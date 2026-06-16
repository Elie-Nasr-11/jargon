import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { IndexPage } from "@/routes/IndexPage";
import { LoginPage } from "@/routes/LoginPage";
import { ChatPage } from "@/routes/ChatPage";

function RootLayout() {
  return <Outlet />;
}

function NotFoundPage() {
  return (
    <div className="loading-screen">
      <div>That page is not here.</div>
    </div>
  );
}

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: IndexPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat",
  component: ChatPage,
});

const routeTree = rootRoute.addChildren([indexRoute, loginRoute, chatRoute]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
