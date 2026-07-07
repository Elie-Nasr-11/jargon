// The workspace-view vocabulary shared by the route's search validation, the sidebar, the
// mobile drawer, and the ViewHost. Absent view = the tutor chat.
export const STUDENT_VIEWS = [
  "overview",
  "classes",
  "calendar",
  "grades",
  "review",
  "messages",
] as const;

export type StudentView = (typeof STUDENT_VIEWS)[number];

export function isStudentView(value: unknown): value is StudentView {
  return typeof value === "string" && (STUDENT_VIEWS as readonly string[]).includes(value);
}

export const VIEW_TITLES: Record<StudentView, string> = {
  overview: "Overview",
  classes: "Classes",
  calendar: "Calendar",
  grades: "Grades",
  review: "Review",
  messages: "Messages",
};
