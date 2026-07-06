import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import type { MentorConfig, VoiceSettings } from "@/lib/jargon-store";

// The mentor/voice controls (tone · verbosity · difficulty · voice · reading speed). Extracted from the
// old HeaderMenus "Mentor" tab so it can be mounted inside the Settings-menu Mentor modal.

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

export function MentorControls({
  mentor,
  onChange,
  voice,
  onVoiceChange,
}: {
  mentor: MentorConfig;
  onChange: (m: MentorConfig) => void;
  voice?: VoiceSettings;
  onVoiceChange?: (v: VoiceSettings) => void;
}) {
  const groups: {
    key: keyof MentorConfig;
    label: string;
    options: MentorConfig[keyof MentorConfig][];
  }[] = [
    { key: "tone", label: "Tone", options: ["Friendly", "Direct", "Socratic"] },
    { key: "verbosity", label: "Verbosity", options: ["Concise", "Balanced", "Detailed"] },
    { key: "difficulty", label: "Difficulty", options: ["Gentle", "Standard", "Challenging"] },
  ];
  const voiceLabel = VOICE_OPTIONS.find((o) => o.value === voice?.voiceName)?.label ?? "Marin";
  const speedLabel = SPEED_OPTIONS.find((o) => o.value === voice?.readAloudRate)?.label ?? "Normal";
  return (
    <div>
      <p className="text-[13px] text-muted-foreground">Shape how the tutor talks back.</p>
      <div className="mt-5 space-y-4">
        {groups.map((g) => (
          <MentorGroup
            key={g.key as string}
            label={g.label}
            options={g.options as string[]}
            value={mentor[g.key] as string}
            onSelect={(opt) => onChange({ ...mentor, [g.key]: opt } as MentorConfig)}
          />
        ))}
        {voice && onVoiceChange ? (
          <>
            <MentorGroup
              label="Voice"
              options={VOICE_OPTIONS.map((o) => o.label)}
              value={voiceLabel}
              onSelect={(opt) => {
                const match = VOICE_OPTIONS.find((o) => o.label === opt);
                if (match) onVoiceChange({ ...voice, voiceName: match.value });
              }}
            />
            <MentorGroup
              label="Reading speed"
              options={SPEED_OPTIONS.map((o) => o.label)}
              value={speedLabel}
              onSelect={(opt) => {
                const match = SPEED_OPTIONS.find((o) => o.label === opt);
                if (match) onVoiceChange({ ...voice, readAloudRate: match.value });
              }}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function MentorGroup({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: string[];
  value: string;
  onSelect: (opt: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const didMount = useRef(false);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const pill = pillRef.current;
    if (!row || !pill) return;
    const idx = options.indexOf(value);
    const btn = btnRefs.current[idx];
    if (!btn) return;
    const props = { x: btn.offsetLeft, width: btn.offsetWidth };
    if (!didMount.current) {
      gsap.set(pill, props);
      didMount.current = true;
    } else {
      gsap.to(pill, { ...props, duration: 0.34, ease: "power3.out" });
    }
  }, [value, options]);

  return (
    <div>
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div ref={rowRef} className="relative flex gap-1.5 rounded-full border border-border p-[3px]">
        <div
          ref={pillRef}
          aria-hidden
          className="absolute left-0 top-[3px] h-[calc(100%-6px)] rounded-full bg-foreground"
          style={{ width: 0, willChange: "transform, width" }}
        />
        {options.map((opt, i) => {
          const active = value === opt;
          return (
            <button
              key={opt}
              type="button"
              ref={(el) => {
                btnRefs.current[i] = el;
              }}
              onClick={() => onSelect(opt)}
              className={`relative z-10 flex-1 rounded-full px-2.5 py-2.5 text-[13px] transition-colors sm:py-1.5 sm:text-[12.5px] ${
                active ? "text-background" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
