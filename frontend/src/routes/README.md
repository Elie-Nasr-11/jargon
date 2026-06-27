# Routes

TanStack Start uses **file-based routing**. Every `.tsx` file in this directory
is a route. Do **not** create `src/pages/`, `src/routes/_app/index.tsx`, or
`app/layout.tsx` — those are Next.js / Remix conventions. The only root layout
is `src/routes/__root.tsx`.

## Conventions

| File                     | URL                                                     |
| ------------------------ | ------------------------------------------------------- |
| `index.tsx`              | `/`                                                     |
| `about.tsx`              | `/about`                                                |
| `users/index.tsx`        | `/users`                                                |
| `users/$id.tsx`          | `/users/:id` (dynamic — bare `$`, no curly braces)      |
| `posts/{-$category}.tsx` | `/posts/:category?` (optional segment)                  |
| `files/$.tsx`            | `/files/*` (splat — read via `_splat` param, never `*`) |
| `_layout.tsx`            | layout route (renders children via `<Outlet />`)        |
| `__root.tsx`             | app shell — wraps every page; preserve `<Outlet />`     |

## `routeTree.gen.ts` is hand-maintained

There is **no** `@tanstack/router-plugin` in `vite.config.ts`, so `routeTree.gen.ts`
is **not** regenerated automatically (despite the header comment in that file). When
you add or remove a route you must edit it by hand: add the import, the
`Route.update({ id, path, getParentRoute })` block, the three `FileRoutesBy*` maps,
the `FileRouteTypes` unions, `RootRouteChildren` + `rootRouteChildren`, and the
`declare module` entry. Mirror an existing flat route (e.g. `teacher.class.$classId`)
exactly.

## Current app routes

| File                                             | URL                                            |
| ------------------------------------------------ | ---------------------------------------------- |
| `index.tsx`                                      | `/`                                            |
| `login.tsx`                                      | `/login`                                       |
| `chat.tsx`                                       | `/chat`                                        |
| `quiz.$assessmentId.tsx`                         | `/quiz/:assessmentId`                          |
| `teacher.tsx`                                    | `/teacher` (home — class picker + queue)       |
| `teacher.class.$classId.tsx`                     | `/teacher/class/:classId` (`?tab=`)            |
| `teacher.class.$classId.student.$studentId.tsx` | `/teacher/class/:classId/student/:studentId`   |
| `teacher.curriculum.tsx`                         | `/teacher/curriculum`                          |
| `admin.tsx`                                      | `/admin` (`?org=&tab=` — org picker + console) |

The teacher routes share `features/teacher/TeacherConsole.tsx` (URL-driven from
`useParams`/`useSearch`); admin keeps org/tab in search params on the single
`/admin` route. See the 2026-06-27 "URL Spine" entry in `docs/DECISIONS.md`.
