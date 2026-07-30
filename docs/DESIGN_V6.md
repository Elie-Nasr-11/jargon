# Design v6 — the premium pass (canonical for the all-surfaces revamp)

Status: canonical. Owner directive 2026-07-30: "fully revamp the ui and chat modes/sections/
inline media logic to make sense; use proper three.js animations to make it feel premium."
Every UI agent in this pass implements against this document.

## 1. Principles

1. **One product, three doors.** Student (/learn), teacher (/teacher), admin (/admin) share one
   design language: the v6 token scale (styles.css), the sidebar shell pattern, the depth ramp
   (border-border + shadow-card + overline section headers), and the ambient layer. A user moving
   between roles should feel the same product.
2. **The conversation is the stage; everything else orbits.** In /learn, panels, docks, media, and
   modes serve the transcript. Nothing competes with reading.
3. **Motion is meaning.** Animation communicates state (mode changes, turns arriving, media
   readiness) — never decoration for its own sake. Every animation respects
   `prefers-reduced-motion` (static or instant variants, already the AmbientCanvas convention).
4. **Naming discipline holds.** TurnMode (message), StepKind (authored step), InputSurface
   (text/code). No bare "mode" in new code.

## 2. The ambient layer (three.js)

`components/AmbientCanvas.tsx` is the base: full-viewport WebGL shader plane, orthographic camera,
`uTime/uIntensity/uRes` uniforms, DPR-capped at 1.5, reduced-motion renders one static frame.

Premium extensions (build as props/uniforms on the SAME component — one canvas, no second WebGL
context per page):

- **`uHue` / accent uniform** — the ambient tint follows context: per-TurnMode accent in /learn
  (read the CSS custom prop `--mode-<id>` at mount/change and lerp), a neutral teacher tint on
  /teacher, a cooler admin tint on /admin, and the brand gradient on /login.
- **`uFocus`** — 0..1 scalar the app can drive: rises briefly when a mentor reply arrives, when a
  mode changes, when a lesson completes (a slow bloom, ~2s ease-out, capped subtle). Never loops.
- **Transitions** — uniform changes lerp over 600-900ms (shader-side mix by a `uBlend` ramp or
  JS-side lerp per frame). Hard cuts are forbidden.
- **Performance floor** — pause the RAF loop when `document.hidden`; keep the fragment shader
  branchless where possible; never allocate in the frame loop. Target: zero perceptible cost on a
  school Chromebook.
- Intensity discipline: 0.22 on working surfaces (chat, console), up to 0.5 on entry surfaces
  (login, Home hero). Completion moments may pulse via `uFocus`, not via intensity swaps.

## 3. Micro-interactions (GSAP — already a dependency)

- Mentor replies: 12px rise + fade, 280ms, power3.out. Student sends: instant (the student did it;
  latency there reads as lag).
- Mode change: the ChatWindow's tinted border + eyebrow pill cross-fade hue over 400ms; the
  ambient hue lerps in sync; the ModeSelector pill uses the MentorGroup slide idiom.
- Panels/docks: 220ms translate+fade; FocusLock surfaces scale from 0.985.
- Counts (Review due, work due, unread): number flips animate; badges never blink.
- Hover states: transform/opacity only — no layout-shifting hovers anywhere.

## 4. Chat modes / sections / inline logic (the "make sense" contract)

- **Four always-modes in the dropdown** (Lesson, Practice, Discuss, Open) + **conditional inline
  pills** (Quiz, Homework, Resources) driven by `envelope.available`. Pills render only when the
  lesson has the thing; their presence IS the signal.
- **Transcript sections**: contiguous stretches of one TurnMode render as a SECTION — the
  mode-tinted border + centered eyebrow label belongs to the stretch, not each bubble. Switching
  modes starts a new section. A reloaded transcript reconstructs sections from persisted turn
  payloads (already stored). Lesson-mode sections carry the step eyebrow (Step N/M · title).
- **Progression honesty**: Discuss/Open sections visually read as "off the spine" (slightly
  desaturated section chrome); the server ceiling already guarantees they can't close gates —
  the UI should *show* that, not restate it in copy.
- **Sidebar lesson tree**: 0/N progress fractions per unit (owner decision), per-lesson state
  dots, current-lesson unit auto-open.

## 5. Inline media (the port from the old surface)

The v6 transcript must render every media kind the platform can attach, with the old surface's
hard-won security/telemetry invariants intact:

| Kind | Renderer | Invariants to preserve |
|---|---|---|
| pdf | inline iframe via signed URL | signed-url only |
| youtube | `youtube-nocookie.com/embed` iframe | nocookie rewrite |
| video/audio | native elements | played/paused/completed telemetry incl. seconds/percent |
| image | inline img | — |
| artifact html_sim | `ArtifactFrame` | `sandbox="allow-scripts"` ONLY, srcdoc-from-TEXT-fetch, no Open-in-tab, poster→Run gate |
| artifact deck | `DeckRenderer` | native render, per-slide read-aloud, completed telemetry |
| link/document/other | card + `window.open` noopener | — |

- Every card fires `recordResourceInteraction` (`shown` on mount + per event) — this feeds the
  mentor's "don't claim they watched it" honesty rule.
- Cards render (a) inline attached to the mentor turn that presented them (envelope resources)
  and (b) in the Resources destination/pill surface for the lesson.
- Read-aloud (`ReadAloudAction`, server TTS first) returns on mentor turns and deck slides.
- Student attachments (v6 Chatbox uploads) keep their existing render path; teacher resources and
  mentor-built artifacts use the table above. Mentor-offered live artifacts (`artifact_offer` /
  `artifact_ready`) get the offer-pill flow in the v6 chatbox.

## 6. Per-surface notes

- **/learn Home**: greeting, resume-last-lesson card, "What your mentor remembers" (memory v1),
  recent grades strip. The memory card is a first-class premium moment (ambient `uFocus` pulse on
  first reveal).
- **/teacher**: keep the stripped IA exactly; re-skin onto the v6 tokens (depth cards, overline
  headers, sidebar polish, ambient at 0.18 neutral). Hotlist rows get state-hue left accents.
- **/admin**: same re-skin, cooler tint, zero new features.
- **/login**: the brand moment — ambient at full presence, card depth, demo-access disclosure kept.
- **/quiz + focus surfaces**: FocusLock scale-in, ambient dims while locked.

## 7. Verification bar for every UI slice

tsc 0 errors · eslint 0 errors · build green · affected python test modules green ·
reduced-motion path verified by reading the code (no RAF loops without the media query guard) ·
no new WebGL contexts beyond the single AmbientCanvas per page.
