/**
 * What a draft request is scoped to — the question the server is really asking.
 *
 * curriculum-admin authorizes a lesson-scoped draft through `courseScopeForLesson`,
 * which refuses any lesson whose COURSE has no owning organization. Every course
 * linked to a class in this product is a shared book with no owner, so that refusal
 * covers the entire library: the assistant answered "Course organization scope was
 * not found." on every lesson a teacher can actually open.
 *
 * Scoping to the CLASS is the fix and the better rule. `duplicate_course` already
 * authorizes this way, and it asks the honest question: not "does this teacher own
 * the book?" but "does this teacher teach this class?". The grounding then comes from
 * the screen (see lessonBrief), which is strictly better than the server's — it sees
 * the words the teacher just typed and has not saved.
 *
 * The union is R88's rule kept intact: a scope must name the organization or the
 * lesson, because a request naming neither is one the server refuses.
 */
export type AssistScope = { classId?: string | null; brief?: string } & (
  | { organizationId: string; lessonId?: string }
  | { lessonId: string; organizationId?: string }
);

/** The scope, as the arguments `draftTextField` takes. One place, so no call drifts. */
export function draftScopeArgs(scope: AssistScope) {
  return {
    classId: scope.classId ?? undefined,
    organizationId: scope.organizationId,
    lessonId: scope.lessonId,
    referenceText: scope.brief || undefined,
  };
}
