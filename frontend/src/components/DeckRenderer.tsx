import { useEffect, useRef, useState } from "react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from "@/components/ui/carousel";
import { ReadAloudAction } from "@/components/ReadAloudAction";
import { deckSlideText, type DeckSpec, type DeckSlide } from "@/lib/artifact-schema";
import type { VoiceSettings } from "@/lib/jargon-store";
import type { VoiceInteractionEvent } from "@/lib/types";

// Artifacts v1 (P6): the native slide-deck renderer. Decks are structured JSON rendered
// with house components and tokens — themed, accessible, and safe by construction (plain
// text only, no HTML) — which is why decks need no Run gate or sandbox. Built on the
// existing embla carousel wrapper; keyboard navigation comes with it.

function SlideBody({ slide }: { slide: DeckSlide }) {
  switch (slide.layout) {
    case "title":
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <div className="font-serif text-display text-foreground">{slide.title}</div>
          {slide.subtitle ? (
            <div className="text-body-lg text-muted-foreground">{slide.subtitle}</div>
          ) : null}
        </div>
      );
    case "bullets":
      return (
        <div className="flex h-full flex-col justify-center gap-3">
          {slide.title ? (
            <div className="font-serif text-title text-foreground">{slide.title}</div>
          ) : null}
          <ul className="list-disc space-y-1.5 pl-5 text-body-lg text-foreground">
            {slide.bullets.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      );
    case "two_col":
      return (
        <div className="flex h-full flex-col justify-center gap-3">
          {slide.title ? (
            <div className="font-serif text-title text-foreground">{slide.title}</div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                { heading: slide.left_title, items: slide.left },
                { heading: slide.right_title, items: slide.right },
              ] as const
            ).map((column, c) => (
              <div key={c} className="min-w-0">
                {column.heading ? (
                  <div className="mb-1.5 text-overline uppercase tracking-[0.1em] text-muted-foreground">
                    {column.heading}
                  </div>
                ) : null}
                <ul className="list-disc space-y-1 pl-5 text-body text-foreground">
                  {column.items.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      );
    case "quote":
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
          <blockquote className="font-serif text-[19px] italic leading-relaxed text-foreground">
            “{slide.quote}”
          </blockquote>
          {slide.attribution ? (
            <div className="text-meta text-muted-foreground">— {slide.attribution}</div>
          ) : null}
        </div>
      );
    case "code":
      return (
        <div className="flex h-full flex-col justify-center gap-2">
          {slide.title ? (
            <div className="font-serif text-title text-foreground">{slide.title}</div>
          ) : null}
          <pre
            className="max-h-56 overflow-auto whitespace-pre-wrap rounded-xl bg-[var(--code-background)] px-4 py-3 text-[12.5px] leading-relaxed text-[var(--code-foreground)]"
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
          >
            {slide.code}
          </pre>
          {slide.caption ? (
            <div className="text-meta text-muted-foreground">{slide.caption}</div>
          ) : null}
        </div>
      );
  }
}

export function DeckRenderer({
  deck,
  title,
  voice,
  accessToken,
  lessonId,
  sessionId,
  onVoiceEvent,
  onCompleted,
}: {
  deck: DeckSpec;
  title: string;
  voice: VoiceSettings;
  accessToken: string;
  lessonId: string;
  sessionId: string | null;
  onVoiceEvent: (event: VoiceInteractionEvent) => void | Promise<void>;
  // Fires ONCE, the first time the last slide is reached.
  onCompleted?: () => void;
}) {
  const [api, setApi] = useState<CarouselApi>();
  const [index, setIndex] = useState(0);
  const completedRef = useRef(false);
  const total = deck.slides.length;

  useEffect(() => {
    if (!api) return;
    const onSelect = () => {
      const selected = api.selectedScrollSnap();
      setIndex(selected);
      if (selected === total - 1 && !completedRef.current) {
        completedRef.current = true;
        onCompleted?.();
      }
    };
    api.on("select", onSelect);
    onSelect();
    return () => {
      api.off("select", onSelect);
    };
  }, [api, total, onCompleted]);

  const active = deck.slides[index];

  return (
    <div
      role="region"
      aria-label={deck.title || title}
      className="rounded-2xl border border-border bg-depth-field p-3"
    >
      <Carousel setApi={setApi} className="w-full" opts={{ align: "start" }}>
        <CarouselContent>
          {deck.slides.map((slide, i) => (
            <CarouselItem key={i}>
              <div className="min-h-[220px] rounded-xl bg-depth-sub px-5 py-6">
                <SlideBody slide={slide} />
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
        <div className="mt-2.5 flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-1.5">
            <CarouselPrevious className="static translate-x-0 translate-y-0" />
            <CarouselNext className="static translate-x-0 translate-y-0" />
          </div>
          <div className="flex items-center gap-2.5">
            {active ? (
              <ReadAloudAction
                key={index}
                text={active.speaker_notes || deckSlideText(active)}
                voice={voice}
                accessToken={accessToken}
                lessonId={lessonId}
                sessionId={sessionId}
                onVoiceEvent={onVoiceEvent}
              />
            ) : null}
            <span className="text-meta tabular-nums text-muted-foreground">
              {index + 1} / {total}
            </span>
          </div>
        </div>
      </Carousel>
    </div>
  );
}
