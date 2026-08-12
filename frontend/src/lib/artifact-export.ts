// Artifact export (Wael, workspace feedback 2026-08-09: "Is there a way I can download
// the outline artifact?"). Both artifact kinds become a plain file the student keeps:
//
//   deck     → one self-contained HTML document (all slides in order, speaker notes
//              included, print CSS so the browser's Print → Save as PDF gives a clean
//              handout). Deck text is plain by construction (artifact-schema), and it
//              is escaped again here — defense in depth, not trust.
//   html_sim → the sim's own HTML as a file. The CALLER must lint-gate it first
//              (lintArtifactHtml): a document we refuse to run in a sandbox is a
//              document we refuse to hand out.
//
// Everything is client-side: build text, Blob it, click a temporary anchor. No new
// network surface, no signed URL ever exposed as a navigable link.

import { deckSlideText, type DeckSlide, type DeckSpec } from "@/lib/artifact-schema";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// "Photosynthesis: An Outline!" -> "photosynthesis-an-outline". Filenames stay ASCII
// and bounded; a fully non-ASCII title falls back to the generic stem.
export function exportFilename(title: string, extension: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "jargon-artifact"}.${extension}`;
}

function slideBodyHtml(slide: DeckSlide): string {
  switch (slide.layout) {
    case "title":
      return (
        `<h2 class="slide-title">${escapeHtml(slide.title)}</h2>` +
        (slide.subtitle ? `<p class="subtitle">${escapeHtml(slide.subtitle)}</p>` : "")
      );
    case "bullets":
      return (
        (slide.title ? `<h2>${escapeHtml(slide.title)}</h2>` : "") +
        `<ul>${slide.bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      );
    case "two_col": {
      const column = (heading: string | undefined, items: string[]) =>
        `<div class="col">` +
        (heading ? `<h3>${escapeHtml(heading)}</h3>` : "") +
        `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` +
        `</div>`;
      return (
        (slide.title ? `<h2>${escapeHtml(slide.title)}</h2>` : "") +
        `<div class="cols">${column(slide.left_title, slide.left)}${column(slide.right_title, slide.right)}</div>`
      );
    }
    case "quote":
      return (
        `<blockquote>&ldquo;${escapeHtml(slide.quote)}&rdquo;</blockquote>` +
        (slide.attribution
          ? `<p class="attribution">&mdash; ${escapeHtml(slide.attribution)}</p>`
          : "")
      );
    case "code":
      return (
        (slide.title ? `<h2>${escapeHtml(slide.title)}</h2>` : "") +
        `<pre><code>${escapeHtml(slide.code)}</code></pre>` +
        (slide.caption ? `<p class="caption">${escapeHtml(slide.caption)}</p>` : "")
      );
  }
}

export function deckToStandaloneHtml(deck: DeckSpec, fallbackTitle: string): string {
  const title = deck.title || fallbackTitle || "Jargon deck";
  const slides = deck.slides
    .map((slide, index) => {
      const notes = slide.speaker_notes
        ? `<aside class="notes"><span>Notes</span> ${escapeHtml(slide.speaker_notes)}</aside>`
        : "";
      return (
        `<section class="slide" aria-label="Slide ${index + 1}">` +
        `<div class="slide-number">${index + 1} / ${deck.slides.length}</div>` +
        slideBodyHtml(slide) +
        notes +
        `</section>`
      );
    })
    .join("\n");
  // deckSlideText keeps the exported <title> honest for a one-slide outline too.
  const documentTitle = escapeHtml(title || deckSlideText(deck.slides[0]));
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${documentTitle}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto; padding: 40px 24px; max-width: 760px;
    font-family: Inter, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #111; background: #fff; line-height: 1.55;
  }
  header h1 { font-size: 26px; margin: 0 0 4px; }
  header p { margin: 0 0 28px; color: #666; font-size: 13px; }
  .slide {
    border: 1px solid #ddd; border-radius: 12px; padding: 22px 24px 18px;
    margin: 0 0 18px; position: relative;
  }
  .slide-number { position: absolute; top: 10px; right: 14px; color: #999; font-size: 11px; }
  .slide h2 { font-size: 19px; margin: 0 0 10px; }
  .slide h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #666; margin: 0 0 6px; }
  .slide-title { font-size: 23px; }
  .subtitle { color: #555; margin: 0; }
  ul { margin: 0; padding-left: 22px; }
  li { margin: 4px 0; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  blockquote { font-style: italic; font-size: 17px; margin: 6px 0; }
  .attribution, .caption { color: #666; font-size: 13px; margin: 6px 0 0; }
  pre {
    background: #f5f5f5; border-radius: 8px; padding: 12px 14px; overflow-x: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px;
  }
  pre code { font-family: inherit; }
  .notes { margin-top: 14px; padding-top: 10px; border-top: 1px dashed #ddd; color: #555; font-size: 13px; }
  .notes span { text-transform: uppercase; letter-spacing: 0.08em; font-size: 10.5px; color: #999; margin-right: 6px; }
  @media print {
    body { padding: 0; }
    .slide { page-break-inside: avoid; border-color: #bbb; }
  }
  @media (max-width: 540px) { .cols { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>${documentTitle}</h1>
  <p>Exported from Jargon &middot; print this page to save it as a PDF</p>
</header>
${slides}
</body>
</html>
`;
}

export function downloadTextFile(filename: string, mimeType: string, text: string): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Deferred so the click's navigation grabs the blob before it is revoked.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
