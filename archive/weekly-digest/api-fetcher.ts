// ARCHIVED 2026-09-03 — R102. The fetcher lifted out of frontend/src/lib/api.ts.
// See ./NOTES.md — the backend it calls has a known bug; fix that before restoring.

// R71: the weekly evidence digest. Teacher-scoped (authorized by class_memberships,
// not admin access) and read-only — it computes over evidence already recorded and
// stores nothing.
export async function fetchClassDigest(input: {
  accessToken: string;
  classId: string;
  days?: number;
}): Promise<ClassDigest | null> {
  const data = await invokeAdminOps({
    accessToken: input.accessToken,
    action: "teacher_class_digest",
    classId: input.classId,
    payload: input.days ? { days: input.days } : undefined,
  });
  const digest = data.data?.digest;
  return digest ? (digest as ClassDigest) : null;
}
