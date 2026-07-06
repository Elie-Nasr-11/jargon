import { MentorGroup } from "@/features/student/MentorControls";
import type { VoiceSettings } from "@/lib/jargon-store";

// The audio settings (mentor voice + reading speed) as their own Settings-menu "Voice" modal.
// Pulled out of the Mentor panel — a student looking for TTS options shouldn't have to guess
// they live under "Mentor".

const VOICE_OPTIONS: { label: string; value: VoiceSettings["voiceName"] }[] = [
  { label: "Marin", value: "marin" },
  { label: "Cedar", value: "cedar" },
  { label: "Coral", value: "coral" },
  { label: "Nova", value: "nova" },
  { label: "Shimmer", value: "shimmer" },
];
const SPEED_OPTIONS: { label: string; value: VoiceSettings["readAloudRate"] }[] = [
  { label: "Slow", value: 0.85 },
  { label: "Normal", value: 1 },
  { label: "Fast", value: 1.2 },
];

export function VoiceControls({
  voice,
  onChange,
}: {
  voice: VoiceSettings;
  onChange: (v: VoiceSettings) => void;
}) {
  const voiceLabel = VOICE_OPTIONS.find((o) => o.value === voice.voiceName)?.label ?? "Marin";
  const speedLabel = SPEED_OPTIONS.find((o) => o.value === voice.readAloudRate)?.label ?? "Normal";
  return (
    <div>
      <p className="text-[13px] text-muted-foreground">
        The voice used for read-aloud and live voice sessions.
      </p>
      <div className="mt-5 space-y-4">
        <MentorGroup
          label="Voice"
          options={VOICE_OPTIONS.map((o) => o.label)}
          value={voiceLabel}
          onSelect={(opt) => {
            const match = VOICE_OPTIONS.find((o) => o.label === opt);
            if (match) onChange({ ...voice, voiceName: match.value });
          }}
        />
        <MentorGroup
          label="Reading speed"
          options={SPEED_OPTIONS.map((o) => o.label)}
          value={speedLabel}
          onSelect={(opt) => {
            const match = SPEED_OPTIONS.find((o) => o.label === opt);
            if (match) onChange({ ...voice, readAloudRate: match.value });
          }}
        />
      </div>
    </div>
  );
}
