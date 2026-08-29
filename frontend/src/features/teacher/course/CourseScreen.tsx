/**
 * The Course screen: the class's curriculum, and nothing beside it.
 *
 * Rebuild brief, step 4. Jobs 1 and 2 — get the book in, check what was written.
 * The outline IS the screen: no books panel, no builder panels sitting open, no
 * drawer. What is rare opens from a menu; what is in flight (a build run, a
 * review) opens over the outline and closes again.
 */
import { useCallback, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, BookOpen, ClipboardCheck, Layers3, Paperclip } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OverflowMenu } from "@/components/OverflowMenu";
import { RouteLoader } from "@/components/RouteLoader";
import { LinkedCoursesPanel } from "@/features/teacher/LinkedCoursesPanel";
import {
  AiOutlinePanel,
  BuildFromMaterialPanel,
} from "@/features/teacher/authoring/generatePanels";
import {
  CourseBuildProgress,
  CourseReviewPanel,
} from "@/features/teacher/course/coursePanels";
import { CourseOutline } from "@/features/teacher/course/CourseOutline";
import { useCourseBuild } from "@/features/teacher/course/useCourseBuild";
import { useCourseData } from "@/features/teacher/course/useCourseData";

export function CourseScreen({
  classId,
  onAddMaterial,
}: {
  classId: string;
  /** Material that belongs to the whole class rather than one lesson — rare, and the
   *  class owns the dialog, so the Course screen only opens it. */
  onAddMaterial?: () => void;
}) {
  const navigate = useNavigate();
  const course = useCourseData(classId);
  const build = useCourseBuild(classId, course);
  const [buildCourseId, setBuildCourseId] = useState<string | null>(null);
  const [buildForUnitId, setBuildForUnitId] = useState<string | null>(null);
  const [coursesOpen, setCoursesOpen] = useState(false);

  const openLesson = useCallback(
    (lessonId: string) => {
      void navigate({
        to: "/teacher/class/$classId/lesson/$lessonId",
        params: { classId, lessonId },
      });
    },
    [navigate, classId],
  );

  /** The build needs a course to hang units on; classes without one get it here. */
  const openCourseBuild = useCallback(() => {
    void course.reloading(
      (accessToken) => course.ensureBackingCourse(accessToken),
      "Could not open the course.",
      (result) => {
        const courseId = (result as { courseId?: string } | null)?.courseId;
        if (courseId) {
          setBuildForUnitId(null);
          setBuildCourseId(courseId);
        }
      },
    );
  }, [course]);

  if (course.loading) return <RouteLoader label="Opening the course…" />;

  const draftUnitIds = [...new Set(course.drafts.map((row) => row.unitId))];
  const resources = course.data?.resources ?? [];

  return (
    <div className="flex flex-col gap-3">
      {/* Job 2 lives in one sentence: something was written and nobody has read it. */}
      {course.drafts.length ? (
        <div className="flex flex-wrap items-center gap-2 rounded-card border border-warning/35 bg-warning/[0.06] px-3.5 py-2.5">
          <ClipboardCheck className="h-4 w-4 shrink-0 text-warning" strokeWidth={1.7} />
          <span className="min-w-0 flex-1 text-meta text-foreground">
            {course.drafts.length} {course.drafts.length === 1 ? "lesson is" : "lessons are"}{" "}
            waiting for your review — students cannot see{" "}
            {course.drafts.length === 1 ? "it" : "them"} yet.
          </span>
          <button
            type="button"
            onClick={() => build.openReview(draftUnitIds)}
            className="btn btn-secondary btn-sm shrink-0"
          >
            Review {course.drafts.length === 1 ? "it" : "them"}
          </button>
        </div>
      ) : null}

      {course.sharedNotice ? (
        <div className="flex flex-wrap items-center gap-2 rounded-card border border-border bg-depth-sub px-3.5 py-2.5 text-meta text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
          <span className="min-w-0 flex-1">
            {course.sharedNotice.isGlobal
              ? "This is a shared book — make a copy for this class before editing or adding lessons."
              : `This course is shared — changes here also reach ${course.sharedNotice.names}.`}
          </span>
          <button
            type="button"
            disabled={course.busy}
            onClick={() => void course.duplicateSharedCourse(course.sharedNotice!.courseId)}
            className="btn btn-secondary btn-sm shrink-0"
          >
            Make a copy for this class
          </button>
        </div>
      ) : null}

      {build.build ? (
        <CourseBuildProgress
          build={build.build}
          onCancel={build.cancelBuild}
          onResume={build.resumeBuild}
          onRetry={build.retryBuildItem}
          onDismiss={build.dismissBuild}
          onReview={draftUnitIds.length ? () => build.openReview(draftUnitIds) : undefined}
        />
      ) : null}

      <CourseOutline
        units={course.outlineUnits}
        lessonsForUnit={course.lessonsForUnit}
        bookPages={course.bookPages}
        stepCountFor={course.stepCountFor}
        busy={course.busy}
        renamingUnitId={course.renamingUnitId}
        onRenameStart={course.setRenamingUnitId}
        onRenameUnit={(unitId, title) => {
          course.setRenamingUnitId(null);
          const current = course.outlineUnits.find((row) => row.unit.id === unitId)?.unit;
          if (title && current && title !== current.title) course.renameUnit(unitId, title);
        }}
        onDeleteUnit={(unitId) => course.deleteNode("unit", unitId)}
        onAddUnit={() => void course.addUnit()}
        onAddLesson={(unitId) => void course.addLesson(unitId, openLesson)}
        onDraftLessons={setBuildForUnitId}
        onOpenLesson={openLesson}
        onReorder={course.reorder}
        onBuildCourse={openCourseBuild}
        menu={
          course.outlineUnits.length ? (
            <OverflowMenu
              label="Course actions"
              actions={[
                {
                  label: "Build from a book…",
                  icon: Layers3,
                  disabled: course.busy,
                  onClick: openCourseBuild,
                },
                {
                  label: "Courses in this class…",
                  icon: BookOpen,
                  onClick: () => setCoursesOpen(true),
                },
                onAddMaterial
                  ? {
                      label: "Add material to this class…",
                      icon: Paperclip,
                      separatorBefore: true,
                      onClick: onAddMaterial,
                    }
                  : null,
              ]}
            />
          ) : null
        }
      />

      <Dialog
        open={Boolean(buildCourseId)}
        onOpenChange={(open) => (open ? null : setBuildCourseId(null))}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>Build this course from a book</DialogTitle>
          </DialogHeader>
          {buildCourseId ? (
            <AiOutlinePanel
              busy={course.busy}
              resources={resources}
              onGenerate={(args) => build.generateOutline(buildCourseId, args)}
              onApply={(outline) => {
                void build.applyOutline(buildCourseId, outline);
                setBuildCourseId(null);
              }}
              onBuild={(outline, material) => {
                build.startCourseBuild(buildCourseId, outline, {
                  material,
                  includeQuiz: true,
                  includeAssignment: true,
                });
                setBuildCourseId(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(buildForUnitId)}
        onOpenChange={(open) => (open ? null : setBuildForUnitId(null))}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[680px]">
          <DialogHeader>
            <DialogTitle>
              Draft a lesson in “
              {course.outlineUnits.find((row) => row.unit.id === buildForUnitId)?.unit.title ||
                "this unit"}
              ”
            </DialogTitle>
          </DialogHeader>
          {buildForUnitId ? (
            <BuildFromMaterialPanel
              busy={course.busy}
              resources={resources}
              onGenerate={(args) => build.generatePackage({ ...args, unitId: buildForUnitId })}
              onApply={(pkg) => {
                void build.applyPackage(buildForUnitId, pkg);
                setBuildForUnitId(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={build.review.open} onOpenChange={(open) => (open ? null : build.closeReview())}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[760px]">
          <DialogHeader>
            <DialogTitle>What was written, before students see it</DialogTitle>
          </DialogHeader>
          <CourseReviewPanel
            review={build.review.rows}
            loading={build.review.loading}
            selected={build.review.picked}
            publishing={build.review.publishing}
            onToggle={build.toggleReviewPick}
            onSelectAll={(next) => {
              for (const row of build.review.rows) {
                const picked = build.review.picked.has(row.lesson_id);
                const wanted = next && row.ready && row.publication_status !== "published";
                if (picked !== wanted) build.toggleReviewPick(row.lesson_id);
              }
            }}
            onPublish={build.publishReviewed}
            onOpenLesson={(lessonId) => {
              build.closeReview();
              openLesson(lessonId);
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={coursesOpen} onOpenChange={(open) => (open ? null : setCoursesOpen(false))}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Courses in this class</DialogTitle>
          </DialogHeader>
          <p className="mb-3 flex items-start gap-1.5 text-meta text-muted-foreground">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
            This is the only surface that changes what students see. It moves to the class&apos;s
            settings when that screen is built.
          </p>
          <LinkedCoursesPanel
            classId={classId}
            courses={course.courseOptions}
            linked={course.linkedCourseIds}
            peerNames={course.peerClassNames}
            onSaved={() => void course.resync()}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
