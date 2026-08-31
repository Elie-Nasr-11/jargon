/**
 * Mechanism A for a single text field — "things arrive already drafted".
 *
 * An EMPTY field on a lesson that has something to draft from gets a proposal, once,
 * without anyone pressing anything. The proposal is held here rather than written into
 * the field, because "always attributed" means a teacher must be able to see at a glance
 * that these words are not theirs. Accepting puts it in the field (their Save still
 * commits it); dismissing leaves the field exactly as empty as it was.
 */
import { useEffect, useRef, useState } from "react";
import { draftTextField, getSession, type DraftableField } from "@/lib/api";
import { wantsProposal, type ProposalState } from "@/features/teacher/assist/proposal";
import { draftScopeArgs, type AssistScope } from "@/features/teacher/assist/scope";

export function useFieldProposal({
  field,
  scope,
  lessonId,
  current,
  origin,
  enabled,
}: {
  field: DraftableField;
  /** Authorization and grounding for the request. */
  scope: AssistScope;
  /** Identity only — the lesson this hook has already offered for, so it offers once. */
  lessonId: string;
  current: string;
  /** What it will be drafted from, in the teacher's words. Also the grounding gate. */
  origin: string;
  enabled: boolean;
}) {
  const [state, setState] = useState<ProposalState<string>>({ status: "idle" });
  const askedFor = useRef<string | null>(null);
  const [declined, setDeclined] = useState(false);

  // The moment the field has something in it — the teacher typed, or took a proposal
  // from the assistant panel — an arrival proposal for the same field is stale. Two
  // offers for one field is the worst of both mechanisms.
  useEffect(() => {
    if (!wantsProposal(current) && state.status === "offered") setState({ status: "idle" });
  }, [current, state.status]);

  useEffect(() => {
    if (!enabled || declined || !origin) return;
    if (!wantsProposal(current)) return;
    if (askedFor.current === `${lessonId}:${field}`) return;
    askedFor.current = `${lessonId}:${field}`;
    setState({ status: "drafting" });
    void (async () => {
      try {
        const session = await getSession();
        if (!session) throw new Error("Sign in to use the assistant.");
        const text = await draftTextField({
          accessToken: session.access_token,
          field,
          ...draftScopeArgs(scope),
        });
        const trimmed = text.trim();
        setState(
          trimmed
            ? { status: "offered", proposal: { value: trimmed, origin, previous: current } }
            : { status: "idle" },
        );
      } catch (error) {
        // A failed proposal is not an error a teacher has to deal with — the field is
        // simply empty, which is where they started. Held for the caller to ignore.
        setState({ status: "failed", message: (error as Error).message || "" });
      }
    })();
    // scope is rebuilt each render; the askedFor guard above is what stops a repeat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, declined, origin, current, field, lessonId]);

  return {
    state,
    dismiss: () => {
      setDeclined(true);
      setState({ status: "idle" });
    },
    accept: () => {
      const value = state.status === "offered" ? state.proposal.value : "";
      setDeclined(true);
      setState({ status: "idle" });
      return value;
    },
  };
}
