// The view vocabulary shared by the route's search validation, the sidebar nav, and the
// main-area pages.
//
// v5.0 shell: navigation is a two-level idea. The PRIMARY split is Home (the LMS — coursework,
// agenda, signal) vs Learn (the tutor chat). Everything else is a secondary destination reachable
// from the sidebar.
//
// `view` absent = Learn (the chat). That convention predates v5.0 and is kept deliberately: every
// existing deep link, the `goView(null)` call in routes/chat.tsx, and the "close the panel, return
// to the conversation" gesture all rely on it. Home is an explicit `?view=home`.
//
// `pulse` is retained as a LEGACY ALIAS for `home` — v4.0 shipped `?view=pulse` as its own surface
// ("Overview"), so bookmarks and shared links carrying it still exist in the wild. It validates,
// resolves to Home, and is not offered in the nav. Do not remove it without a redirect.
export const STUDENT_VIEWS = [
  "home",
  "classes",
  "resources",
  "routines",
  "customize",
  "reports",
  "pulse",
] as const;

export type StudentView = (typeof STUDENT_VIEWS)[number];

export function isStudentView(value: unknown): value is StudentView {
  return typeof value === "string" && (STUDENT_VIEWS as readonly string[]).includes(value);
}

// Resolve a raw view to the surface that should actually render. Collapses the legacy alias so
// every consumer downstream can switch on a canonical value.
export type CanonicalStudentView = Exclude<StudentView, "pulse">;

export function canonicalView(view: StudentView | undefined): CanonicalStudentView | undefined {
  if (!view) return undefined;
  return view === "pulse" ? "home" : view;
}

export const VIEW_TITLES: Record<StudentView, string> = {
  home: "Home",
  classes: "Classes",
  resources: "Resources",
  routines: "Routines",
  customize: "Customize",
  reports: "Reports",
  // Legacy alias — titled as its destination so a stale link never shows a name the nav lacks.
  pulse: "Home",
};

// The label for the chat itself (view absent). Lives here so the sidebar and any breadcrumb agree.
export const LEARN_TITLE = "Learn";
