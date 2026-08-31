/**
 * The rubric's eight dimensions, said the way a teacher would say them — and the move
 * §19 makes when one of them is weak, said as something a PERSON does next.
 *
 * One home for this vocabulary because two surfaces render it (a student's Thinking tab
 * and the class room view), and two copies of a label list drift.
 */
import type { CognitionDims } from "@/lib/api";

export type DimensionKey = keyof CognitionDims;

export const DIMENSION_LABELS: Array<{ key: DimensionKey; label: string }> = [
  { key: "retrieval", label: "Recalls the knowledge" },
  { key: "organization", label: "Connects ideas" },
  { key: "reasoning", label: "Reasons with it" },
  { key: "elaboration", label: "Develops ideas" },
  { key: "vocabulary", label: "Uses the terms" },
  { key: "expression", label: "Expresses clearly" },
  { key: "independence", label: "Thinks independently" },
  { key: "metacognition", label: "Checks own thinking" },
];

export const DIMENSION_LABEL: Record<DimensionKey, string> = DIMENSION_LABELS.reduce(
  (map, entry) => ({ ...map, [entry.key]: entry.label }),
  {} as Record<DimensionKey, string>,
);

/**
 * What to DO about a weak dimension, addressed to the teacher. These are the same
 * moves §19 hands the mentor, rewritten for a person who is planning a lesson rather
 * than answering a turn — a teacher cannot act on "RETRIEVAL FIRST:".
 */
export const DIMENSION_MOVE: Record<DimensionKey, string> = {
  retrieval: "Ask them to recall it before you give it back.",
  organization: "Ask how two things they said connect — which causes which.",
  reasoning: "Stop accepting bare answers. Ask why, and respond to the reason.",
  elaboration: "Their answers stop at the first idea. Ask for an example, or the next step.",
  vocabulary: "Ask for the word before you supply it.",
  expression: "The thinking is sound and the wording slips. Ask them to say it again their way.",
  independence: "Give less. Make them produce before you add anything.",
  metacognition: "Ask how sure they are, and what would make them surer.",
};
