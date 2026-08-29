/**
 * The authoring payload, and the two ways anything writes to it.
 *
 * Both authoring screens — the course outline and the lesson — read the same
 * snapshot and edit it the same way, so the fetch and the write discipline live
 * here rather than once per screen. They share one React Query entry, which is
 * why walking from the outline into a lesson and back is instant.
 *
 * optimistic() is for edits we can reconstruct locally (rename, reorder, patch a
 * step): apply it here, persist behind, resync only if the server disagrees.
 * reloading() is for writes we cannot reconstruct (a create, a bulk apply): run,
 * then refetch. Everything else is a bug waiting to happen.
 */
import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchCurriculumAuthoringData, getSession } from "@/lib/api";
import { notifyErr } from "@/lib/feedback";
import type { CurriculumAuthoringData } from "@/lib/types";

export type AuthoringData = ReturnType<typeof useAuthoringData>;

export function useAuthoringData(classId: string) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: getSession,
    staleTime: 5 * 60 * 1000,
  });
  const teacherId = sessionQuery.data?.user.id ?? null;

  const key = useMemo(() => ["curriculumAuthoring", teacherId] as const, [teacherId]);
  const dataQuery = useQuery({
    queryKey: key,
    queryFn: () => fetchCurriculumAuthoringData(teacherId as string),
    enabled: Boolean(teacherId),
    staleTime: 60 * 1000,
  });
  const data = dataQuery.data ?? null;

  const patch = useCallback(
    (apply: (current: CurriculumAuthoringData) => CurriculumAuthoringData) => {
      queryClient.setQueryData<CurriculumAuthoringData>(key, (current) =>
        current ? apply(current) : current,
      );
    },
    [queryClient, key],
  );

  const resync = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: key });
  }, [queryClient, key]);

  const optimistic = useCallback(
    (
      apply: (current: CurriculumAuthoringData) => CurriculumAuthoringData,
      run: (accessToken: string) => Promise<unknown>,
      opts?: { onSuccess?: (result: unknown) => void; failure?: string },
    ) => {
      patch(apply);
      void (async () => {
        try {
          const session = await getSession();
          if (!session) throw new Error("Sign in to edit this class.");
          opts?.onSuccess?.(await run(session.access_token));
        } catch (error) {
          notifyErr(error, opts?.failure || "Could not save that change.");
          await resync();
        }
      })();
    },
    [patch, resync],
  );

  const reloading = useCallback(
    async (
      run: (accessToken: string) => Promise<unknown>,
      failure: string,
      onDone?: (result: unknown) => void,
    ) => {
      setBusy(true);
      try {
        const session = await getSession();
        if (!session) throw new Error("Sign in to edit this class.");
        const result = await run(session.access_token);
        await resync();
        onDone?.(result);
      } catch (error) {
        notifyErr(error, failure);
        await resync();
      } finally {
        setBusy(false);
      }
    },
    [resync],
  );

  const classSummary = useMemo(
    () => data?.classes.find((row) => row.id === classId) ?? null,
    [data, classId],
  );

  return {
    loading: sessionQuery.isPending || dataQuery.isPending,
    busy,
    setBusy,
    teacherId,
    data,
    classSummary,
    patch,
    resync,
    optimistic,
    reloading,
  };
}
