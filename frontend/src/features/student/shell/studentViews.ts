// The v5 panel vocabulary shared by the route's search validation, the edge chrome, and the
// SlideOver host. Absent view = the tutor chat (the stage). Two peripheries only: Classes (the
// world of coursework) and Pulse (time + signal: agenda, grades, activity, performance). A class
// canvas is Classes + a `class` search param, not its own view.
export const STUDENT_VIEWS = ["classes", "pulse"] as const;

export type StudentView = (typeof STUDENT_VIEWS)[number];

export function isStudentView(value: unknown): value is StudentView {
  return typeof value === "string" && (STUDENT_VIEWS as readonly string[]).includes(value);
}

export const VIEW_TITLES: Record<StudentView, string> = {
  classes: "Classes",
  pulse: "Pulse",
};
