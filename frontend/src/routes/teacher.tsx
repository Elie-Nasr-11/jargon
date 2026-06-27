import { createFileRoute } from "@tanstack/react-router";
import { TeacherConsole } from "@/features/teacher/TeacherConsole";

export const Route = createFileRoute("/teacher")({
  head: () => ({
    meta: [
      { title: "Teacher - Jargon" },
      {
        name: "description",
        content: "Teacher dashboard for Jargon classes, transcripts, evidence, and notes.",
      },
    ],
  }),
  component: TeacherConsole,
});
