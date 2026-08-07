import { KnowledgeCard } from "@/student/KnowledgeCard";
import { useConversationChannel } from "@/student/useConversation";

// Learning framework (F2/F3) notification surface, mounted by ChatWindow.
//
// R32 (owner: "much better design for the link and vocab popups"): there used to be THREE
// surfaces — a full-screen SVG flash in the centre, vocab banners dropping from the top
// centre, and growth toasts stacking top right — all firing for the same moment. A turn
// that taught three words covered the screen in chrome. They are now ONE card (see
// KnowledgeCard), which also delivers the owner's earlier ask that several vocab words
// share a single pop-up instead of stacking.
//
// The dismissal contract is unchanged and deliberate: nothing here is on a timer. A new
// word or a new connection is the point of the lesson, and losing it to a countdown while
// the student is still reading was exactly backwards. Reduced motion only drops the
// entrance animation — the card itself still shows, because it carries the information.

export function KnowledgeToasts({ onSeeBrain }: { onSeeBrain?: () => void }) {
  const channel = useConversationChannel();
  if (!channel.knowledgeToasts.length) return null;
  return (
    <KnowledgeCard
      toasts={channel.knowledgeToasts}
      onSeeBrain={onSeeBrain}
      onDismiss={() => {
        for (const toast of channel.knowledgeToasts) channel.dismissToast(toast.id);
      }}
    />
  );
}
