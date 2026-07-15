// Artifacts v1 (P6): the artifact config + deck slide schema, with a tolerant parser.
// Shared by the api layer (raw metadata.artifact), the chat envelope field (already
// server-sanitized — the parser is idempotent), the renderers, and P7's authoring flow.
// All deck text is PLAIN — no markdown in v1.

export type DeckSlide =
  | { layout: "title"; title: string; subtitle?: string; speaker_notes?: string }
  | { layout: "bullets"; title?: string; bullets: string[]; speaker_notes?: string }
  | {
      layout: "two_col";
      title?: string;
      left_title?: string;
      right_title?: string;
      left: string[];
      right: string[];
      speaker_notes?: string;
    }
  | { layout: "quote"; quote: string; attribution?: string; speaker_notes?: string }
  | {
      layout: "code";
      title?: string;
      code: string;
      language?: string;
      caption?: string;
      speaker_notes?: string;
    };
// NOTE: no "image" layout in v1 — there is no asset pipeline yet; revisit with P7+.

export type DeckSpec = { title?: string; slides: DeckSlide[] };

export type ArtifactConfig = {
  kind: "html_sim" | "deck";
  version: 1;
  height_hint?: number; // clamped 200..1200
  poster_text?: string; // <= 500 chars
  deck?: DeckSpec; // present iff kind === "deck"
};

export const DECK_MAX_SLIDES = 40;
const MAX_LIST_ITEMS = 12;
const MAX_ITEM_CHARS = 300;
const MAX_TEXT_CHARS = 500;
const MAX_CODE_CHARS = 4000;

function cleanText(value: unknown, max = MAX_TEXT_CHARS): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item, MAX_ITEM_CHARS))
    .filter(Boolean)
    .slice(0, MAX_LIST_ITEMS);
}

function parseSlide(raw: unknown): DeckSlide | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const slide = raw as Record<string, unknown>;
  const notes = cleanText(slide.speaker_notes, 1000) || undefined;
  switch (slide.layout) {
    case "title": {
      const title = cleanText(slide.title);
      if (!title) return null;
      return {
        layout: "title",
        title,
        subtitle: cleanText(slide.subtitle) || undefined,
        speaker_notes: notes,
      };
    }
    case "bullets": {
      const bullets = cleanList(slide.bullets);
      if (!bullets.length) return null;
      return {
        layout: "bullets",
        title: cleanText(slide.title) || undefined,
        bullets,
        speaker_notes: notes,
      };
    }
    case "two_col": {
      const left = cleanList(slide.left);
      const right = cleanList(slide.right);
      if (!left.length && !right.length) return null;
      return {
        layout: "two_col",
        title: cleanText(slide.title) || undefined,
        left_title: cleanText(slide.left_title, 80) || undefined,
        right_title: cleanText(slide.right_title, 80) || undefined,
        left,
        right,
        speaker_notes: notes,
      };
    }
    case "quote": {
      const quote = cleanText(slide.quote, 600);
      if (!quote) return null;
      return {
        layout: "quote",
        quote,
        attribution: cleanText(slide.attribution, 120) || undefined,
        speaker_notes: notes,
      };
    }
    case "code": {
      const code = typeof slide.code === "string" ? slide.code.slice(0, MAX_CODE_CHARS) : "";
      if (!code.trim()) return null;
      return {
        layout: "code",
        title: cleanText(slide.title) || undefined,
        code,
        language: cleanText(slide.language, 24) || undefined,
        caption: cleanText(slide.caption) || undefined,
        speaker_notes: notes,
      };
    }
    default:
      // Unknown layouts drop silently — additive future layouts must not crash old clients.
      return null;
  }
}

// Tolerant + idempotent: accepts the raw metadata.artifact value OR the already
// server-sanitized envelope field. Returns a fully validated config or null.
export function parseArtifactConfig(raw: unknown): ArtifactConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const cfg = raw as Record<string, unknown>;
  if (cfg.kind !== "html_sim" && cfg.kind !== "deck") return null;
  if (cfg.version !== undefined && cfg.version !== 1) return null;
  const out: ArtifactConfig = { kind: cfg.kind, version: 1 };
  if (typeof cfg.height_hint === "number" && Number.isFinite(cfg.height_hint)) {
    out.height_hint = Math.min(1200, Math.max(200, Math.round(cfg.height_hint)));
  }
  const poster = cleanText(cfg.poster_text);
  if (poster) out.poster_text = poster;
  if (cfg.kind === "deck") {
    const deckRaw = cfg.deck;
    if (!deckRaw || typeof deckRaw !== "object" || Array.isArray(deckRaw)) return null;
    const deck = deckRaw as Record<string, unknown>;
    const slides = (Array.isArray(deck.slides) ? deck.slides : [])
      .map(parseSlide)
      .filter((slide): slide is DeckSlide => slide !== null)
      .slice(0, DECK_MAX_SLIDES);
    if (!slides.length) return null;
    out.deck = { title: cleanText(deck.title) || undefined, slides };
  }
  return out;
}

// The visible text of a slide, for read-aloud fallback when speaker_notes are absent.
export function deckSlideText(slide: DeckSlide): string {
  switch (slide.layout) {
    case "title":
      return [slide.title, slide.subtitle].filter(Boolean).join(". ");
    case "bullets":
      return [slide.title, ...slide.bullets].filter(Boolean).join(". ");
    case "two_col":
      return [slide.title, slide.left_title, ...slide.left, slide.right_title, ...slide.right]
        .filter(Boolean)
        .join(". ");
    case "quote":
      return [slide.quote, slide.attribution].filter(Boolean).join(" — ");
    case "code":
      return [slide.title, slide.caption].filter(Boolean).join(". ") || "A code example.";
  }
}
