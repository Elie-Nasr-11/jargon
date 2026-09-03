// ARCHIVED 2026-09-03 — R102. The wire types the digest used, lifted out of
// frontend/src/lib/types.ts. The action string "teacher_class_digest" was also removed
// from the AdminOpsAction union in that file.

export type ClassDigestStudent = {
  user_id: string;
  name: string;
  minutes: number;
  turns: number;
  lessons_touched: number;
  lessons_completed: number;
  steps_done: number;
};

export type ClassDigest = {
  window: { from: string; to: string; days: number };
  students: { enrolled: number; active: number };
  totals: {
    minutes?: number;
    turns?: number;
    lessons_completed?: number;
    steps_done?: number;
    evidence?: number;
  };
  movers: ClassDigestStudent[];
  stalled: ClassDigestStudent[];
  reteach: { skill_key: string; students: number; pattern: string }[];
};

