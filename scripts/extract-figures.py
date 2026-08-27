#!/usr/bin/env python3
"""R69: crop the FIGURE out of a book page, not the whole page.

Until now a lesson figure was a full-page scan: the student tapped a diagram
and got a picture of page 34 — headers, body text, page number and all. The
mentor's prompt tells it to point at what is IN the figure ("the stacked layers
labelled B"), which reads as nonsense against a whole page.

These books are VECTOR-drawn (no embedded raster images at all), so a figure is
a cluster of drawing operations. This finds those clusters, keeps the ones that
are art, pulls in the caption that belongs to them, and renders a tight crop.

    python3 scripts/extract-figures.py --book a1 --pages books/itf-a1/pages.json \\
        --pdf "IT Frontiers - Advanced - Book A1 - Teacher Edition.pdf" \\
        --out frontend/public/books --report scratch/a1-figures.json

Writes <out>/<lesson>/p<page>-fig.jpg next to the existing p<page>.jpg page
scans — the scan stays as the fallback for pages where nothing confident was
found, so a bad detection degrades to today's behaviour, never to a blank.

Requires PyMuPDF (pip install pymupdf).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

try:
    import pymupdf
except ImportError:  # pragma: no cover - operator-facing
    print("PyMuPDF is required: pip install pymupdf", file=sys.stderr)
    raise SystemExit(2)

PAD = 8            # breathing room around a crop (pt)
GAP = 24           # two drawings this close belong to one figure
BAND_GAP = 16      # vertical merge — near-touching bands only
TOP_MARGIN = 60    # running header
BOT_MARGIN = 28    # page number sits below this; captions must not be clipped
MIN_FRAC = 0.03    # a real figure covers at least this much of the page
MAX_FRAC = 0.80    # bigger than this is a full-bleed background, not a figure
MIN_ART_DENSITY = 15   # drawn ops per unit of page area; measured across both
                       # books the activity worksheets sit at 9-10 and the
                       # thinnest real figure at 21, so 15 splits them cleanly


def union(a: pymupdf.Rect, b: pymupdf.Rect) -> pymupdf.Rect:
    return pymupdf.Rect(min(a.x0, b.x0), min(a.y0, b.y0), max(a.x1, b.x1), max(a.y1, b.y1))


def near(a: pymupdf.Rect, b: pymupdf.Rect, gap: float) -> bool:
    return pymupdf.Rect(a.x0 - gap, a.y0 - gap, a.x1 + gap, a.y1 + gap).intersects(b)


def y_overlap(a: pymupdf.Rect, b: pymupdf.Rect) -> bool:
    return min(a.y1, b.y1) - max(a.y0, b.y0) > 0


def detect_figures(page: pymupdf.Page) -> list[dict]:
    """Figure regions on one page, largest first."""
    width, height = page.rect.width, page.rect.height
    content = pymupdf.Rect(0, TOP_MARGIN, width, height - BOT_MARGIN)
    page_area = width * height

    items = []
    for drawing in page.get_drawings():
        rect = pymupdf.Rect(drawing["rect"])
        # A perfectly horizontal or vertical stroke has zero thickness, and a
        # zero-thickness rect reads as EMPTY — which silently discarded every
        # grid line in the book's drawn data tables. Give such strokes a hair of
        # thickness instead of dropping them.
        if rect.width <= 0 and rect.height <= 0:
            continue
        if rect.width <= 0 or rect.height <= 0:
            rect = pymupdf.Rect(rect.x0, rect.y0, rect.x0 + max(rect.width, 0.5), rect.y0 + max(rect.height, 0.5))
        if not rect.intersects(content):
            continue
        if rect.width * rect.height > MAX_FRAC * page_area:
            continue
        if rect.height < 3 and rect.width > 200:      # a rule, not a picture
            continue
        kinds = {item[0] for item in drawing.get("items", [])}
        # Curves and lines are drawn art. A plain filled rectangle is panel
        # chrome until something else vouches for it.
        art = bool(kinds & {"c", "qu", "l"}) or (
            drawing.get("type") != "f" and "re" in kinds and rect.height > 24
        )
        items.append({"rect": rect, "art": art})

    clusters: list[dict] = []
    for item in items:
        for cluster in clusters:
            if near(cluster["rect"], item["rect"], GAP):
                cluster["rect"] = union(cluster["rect"], item["rect"])
                cluster["n"] += 1
                cluster["art"] += int(item["art"])
                break
        else:
            clusters.append({"rect": +item["rect"], "n": 1, "art": int(item["art"])})
    changed = True
    while changed:                                    # merging can bridge clusters
        changed = False
        merged: list[dict] = []
        for cluster in clusters:
            for other in merged:
                if near(other["rect"], cluster["rect"], GAP):
                    other["rect"] = union(other["rect"], cluster["rect"])
                    other["n"] += cluster["n"]
                    other["art"] += cluster["art"]
                    changed = True
                    break
            else:
                merged.append(cluster)
        clusters = merged

    blocks = [
        (pymupdf.Rect(b[:4]), b[4])
        for b in page.get_text("blocks")
        if b[6] == 0 and pymupdf.Rect(b[:4]).intersects(content)
    ]

    def text_cover(rect: pymupdf.Rect) -> float:
        area = rect.width * rect.height
        if area <= 0:
            return 1.0
        covered = sum(
            (rect & tb).width * (rect & tb).height for tb, _ in blocks if rect.intersects(tb)
        )
        return covered / area

    sized = [
        c for c in clusters
        if (c["rect"] & content).width * (c["rect"] & content).height >= 0.008 * page_area
    ]
    # Art is drawn with curves/strokes, OR built from many filled shapes with
    # little text over them (the server-rack illustrations are all rectangles),
    # OR a grid of many cells — a drawn data table, which carries text but is a
    # picture of structure. The key-fact banners this must never match are one
    # or two filled rectangles, so the cell count separates them cleanly.
    arty = [
        c for c in sized
        if c["art"] >= 3
        or (c["n"] >= 12 and text_cover(c["rect"]) < 0.25)
        or c["n"] >= 18
    ]
    if not arty:
        return []

    # A text panel joins the figure only when it sits BESIDE art (the "steps"
    # box between the wheat and the bread). Alone in its band it is one of the
    # book's key-fact banners — never a figure.
    kept = [c for c in sized if c in arty or any(y_overlap(c["rect"], a["rect"]) for a in arty)]
    for cluster in clusters:                          # small satellites: an icon, a label
        if cluster in kept:
            continue
        if any(
            y_overlap(cluster["rect"], a["rect"]) and near(a["rect"], cluster["rect"], 70)
            for a in arty
        ):
            kept.append(cluster)

    kept.sort(key=lambda c: c["rect"].y0)
    bands: list[dict] = []
    for cluster in kept:
        if bands and cluster["rect"].y0 - bands[-1]["rect"].y1 < BAND_GAP:
            bands[-1]["rect"] = union(bands[-1]["rect"], cluster["rect"])
            bands[-1]["art"] += cluster["art"]
        else:
            bands.append(dict(cluster))

    figures = []
    for band in bands:
        rect = +band["rect"]
        for block, text in blocks:                    # caption below, short label above
            if re.fullmatch(r"\s*\d{1,3}\s*", text):  # the page number
                continue
            within_x = block.x0 > rect.x0 - 0.12 * rect.width and block.x1 < rect.x1 + 0.12 * rect.width
            below = 0 <= block.y0 - rect.y1 <= 42 and block.height <= 110
            above = 0 <= rect.y0 - block.y1 <= 26 and block.height <= 20
            if within_x and (below or above):
                rect = union(rect, block)
        rect = pymupdf.Rect(rect.x0 - PAD, rect.y0 - PAD, rect.x1 + PAD, rect.y1 + PAD) & content
        frac = (rect.width * rect.height) / page_area
        if frac < MIN_FRAC:
            continue
        # The activity worksheets are big ruled tables of sentences: a handful of
        # strokes stretched over half a page. Illustrations are DENSE — dozens of
        # drawing operations packed into a small area — so density, not size,
        # separates a picture from a page of ruled lines.
        if band["art"] / frac < MIN_ART_DENSITY:
            continue
        figures.append({"rect": rect, "art": band["art"], "frac": round(frac, 3)})
    figures.sort(key=lambda f: f["rect"].width * f["rect"].height, reverse=True)
    return figures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--book", required=True, help="book key, e.g. a1")
    parser.add_argument("--pdf", required=True, help="path to the book PDF")
    parser.add_argument("--pages", required=True, help="pages.json listing lesson -> pages")
    parser.add_argument("--out", required=True, help="directory holding <lesson>/ image folders")
    parser.add_argument("--report", default="", help="write a JSON report here")
    parser.add_argument("--zoom", type=float, default=2.5, help="render scale (default 2.5)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    manifest = json.loads(Path(args.pages).read_text(encoding="utf-8"))
    doc = pymupdf.open(args.pdf)
    out_root = Path(args.out)

    report: list[dict] = []
    cropped = skipped = 0
    for lesson, entries in sorted(manifest.get("lessons", {}).items()):
        folder = out_root / lesson
        for entry in entries:
            page_no = int(entry["page"])
            if page_no < 1 or page_no > len(doc):
                continue
            page = doc[page_no - 1]
            figures = detect_figures(page)
            row = {
                "lesson": lesson,
                "page": page_no,
                "heading": entry.get("heading", ""),
                "figures": len(figures),
            }
            if not figures:
                skipped += 1
                row["result"] = "no_figure_full_page_kept"
                report.append(row)
                continue
            best = figures[0]
            row["result"] = "cropped"
            row["frac"] = best["frac"]
            row["multiple"] = len(figures) > 1
            target = folder / f"p{page_no}-fig.jpg"
            if not args.dry_run:
                folder.mkdir(parents=True, exist_ok=True)
                pix = page.get_pixmap(matrix=pymupdf.Matrix(args.zoom, args.zoom), clip=best["rect"])
                pix.save(target, jpg_quality=88)
            row["file"] = str(target.relative_to(out_root))
            cropped += 1
            report.append(row)

    print(f"{args.book}: {cropped} cropped, {skipped} left as full-page scans")
    if args.report:
        Path(args.report).parent.mkdir(parents=True, exist_ok=True)
        Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(f"report → {args.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
