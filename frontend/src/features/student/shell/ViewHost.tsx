import { ViewShell } from "@/features/student/shell/ViewShell";
import { VIEW_TITLES, type StudentView } from "@/features/student/shell/studentViews";
import { OverviewPanel } from "@/features/student/OverviewPanel";
import { ClassesPanel } from "@/features/student/ClassesPanel";
import { StudentCalendarBody } from "@/features/student/StudentCalendar";
import { GradesPanel } from "@/features/student/GradesPanel";
import { ReviewPanel } from "@/features/student/ReviewPanel";
import { MessagesPanel } from "@/features/student/MessagesPanel";
import type { MentorPreferences } from "@/lib/types";

// Renders the active workspace view inside the shared ViewShell chrome. One switch so the
// per-view prop plumbing lives in a single place; panels self-fetch on mount (the host remounts
// per view change via key={view} at the call site).
export function ViewHost({
  view,
  onBack,
  onGo,
  currentLessonTitle,
  onOpenLesson,
  accessToken,
  mentorPreferences,
  dmDeepLinkChannel,
}: {
  view: StudentView;
  onBack: () => void;
  onGo: (view: StudentView) => void;
  currentLessonTitle: string | null;
  onOpenLesson: (lessonId: string) => void;
  accessToken: string | null;
  mentorPreferences: MentorPreferences;
  dmDeepLinkChannel: string | null;
}) {
  return (
    <ViewShell title={VIEW_TITLES[view]} onBack={onBack} fill={view === "messages"}>
      {view === "overview" ? (
        <OverviewPanel
          currentLessonTitle={currentLessonTitle}
          onContinue={onBack}
          onOpenGrades={() => onGo("grades")}
          onOpenReview={() => onGo("review")}
        />
      ) : view === "classes" ? (
        <ClassesPanel onOpenLesson={onOpenLesson} />
      ) : view === "calendar" ? (
        <div className="mx-auto w-full max-w-[720px]">
          <StudentCalendarBody />
        </div>
      ) : view === "grades" ? (
        <GradesPanel />
      ) : view === "review" ? (
        <ReviewPanel accessToken={accessToken} mentorPreferences={mentorPreferences} />
      ) : (
        <MessagesPanel initialChannelId={dmDeepLinkChannel} />
      )}
    </ViewShell>
  );
}
