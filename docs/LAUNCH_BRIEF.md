# Launch brief — the polishing round (R96, 2026-09-01)

One document, every gap found, each with where it is, how sure I am, and what it costs.
It is written for choosing from, not as a plan: nothing here is ordered by what I think
you should do first. Pick, and the fixes follow.

## How this was produced, and what it can and cannot see

- **Looked at** = a screenshot I read. 15 desktop screens dark, the same 15 light, 5 phone
  (390×844), and 14 click-throughs (lesson, student detail, Thinking tab, Ask Jargon,
  student Overview, both account menus, student Profile/Customize, the admin org and its
  tabs). Captures live in the session scratchpad, not in the repo.
- **Measured** = a grep, a scan, or a toolchain run over `frontend/src` at commit `19b1de4`.
  Counts are exact for that commit.
- **Inferred** = a consequence I reasoned to from code I read but did not execute. Marked
  as such; treat as a lead, not a fact.
- The walk runs against an offline mock backend. It has no realtime socket and answers
  `admin-ops` with 403, so the teacher digest shows its error state and the live strip never
  updates. Both are harness artifacts — they are **not** in this list. The mock also cannot
  exercise a real chat turn, the scorer, or a build, so those flows are covered by their
  pin suites, not by eye.
- Not looked at: the quiz and assignment surfaces from the student side, the lesson editor's
  dialogs (StepCard, generatePanels), the grading screens, the live Watch transcript, the
  notifications menu, the course build flow, roster import, class settings dialogs. Gaps
  there are gaps in this brief.

**Baseline today.** `tsc --noEmit`: 0 errors. `eslint src`: 0 errors, 36 warnings (35
`react-refresh/only-export-components`, 1 `react-hooks/exhaustive-deps`). `vite build`: green,
with the >500 kB chunk warning. Python pins: 1454 OK, 4 skipped, 11.8 s. Browser console across
39 captures: nothing beyond the two harness artifacts. Live backend (verified in R95): chat
v116, curriculum-admin v43, cognition-scorer v11, sweep cron active with no failed runs.

**Cost key.** S = under an hour. M = about half a day. L = a day or more. Costs are for the
fix plus its pin and doc line, not the fix alone.

---

## A. I would not ship with these

| # | What | Where | Evidence | Cost |
|---|---|---|---|---|
| A1 | The sign-in password field's placeholder is a plausible real password string, visible before typing. It reads as a hint. | `frontend/src/routes/login.tsx:191` | looked at (d-00, l-00), measured | S |
| A2 | "Demo access" sits on the production sign-in page: three demo roles with `example.com` emails and "use the demo password you were given". No environment gate (`import.meta.env` does not appear in the file). A school's first screen carries a pilot affordance. | `login.tsx:17-22, 222-265` | looked at, measured | S — gate behind a `VITE_` flag or delete |
| A3 | On a phone, a student's first screen has the menu button sitting on top of the greeting ("☰ood eveni…"), and in Learn it sits on top of the newest bubble at the top of the transcript. The button is `fixed left-3 top-3` with no offset on the content beneath it; the teacher shell offsets (its Home pill clears the button), the student shell does not. | `frontend/src/student/StudentApp.tsx:833-835` vs `features/teacher/shell/TeacherShell.tsx:94-96` | looked at (p-10, p-11) | S |
| A4 | On a phone, the teacher's class screens (Today, People) are wider than the viewport: the card runs off the right edge and the Watch buttons are unreachable without sideways scrolling. | `features/teacher/today/TodayScreen.tsx:86-112` (name `min-w-[140px] shrink-0`, Watch `shrink-0`); People roster rows | looked at (p-21, p-22); see §H for the measured offenders | M |
| A5 | On a phone, the teacher landing's "To review" rows shrink the student's name to one letter ("O…") because the three chips beside it are `shrink-0`. | `features/teacher/console/GlobalReviewQueue.tsx:37-45` | looked at (p-20), measured | S |

A1 and A2 are the only two I would call blockers regardless of device. A3–A5 are blockers
only if teachers or students will hold phones in the pilot; you know that and I do not.

---

## B. Words — where the screen disagrees with the lexicon

`docs/LEXICON.md` says a retired word on a screen "is a defect — not a style preference".
Twenty-five hits, all measured:

| # | Retired word | Where | Cost |
|---|---|---|---|
| B1 | **Resources** (→ material) | `features/teacher/authoring/StepCard.tsx:523` — and this one points at "the class console's Resources tab", a place that no longer exists; `authoring/referenceInput.tsx:41`; `console/StudentDetail.tsx:541`; `console/ResourceManager.tsx:153,175`; `student/ClassSummary.tsx:325`; `features/admin/SetupPanel.tsx:57` ("Work/resources prepared") | S each |
| B2 | **Assessment** (→ quiz) | `TeacherConsole.tsx:601`; `StepCard.tsx:416,439`; `student/AssessmentSurface.tsx:181,192` | S each |
| B3 | **Checkpoint** (→ quiz / check) | `authoring/stepModel.tsx:48`; `student/StudentApp.tsx:610`; `student/Transcript.tsx:950,954` | S each |
| B4 | **Seeding** | `features/admin/AdminPage.tsx:394`; `routes/login.tsx:22` ("Seeding, live view, costs"); `routes/admin.tsx:27`; `features/admin/ClassesPanel.tsx:147,188` ("seed a roster", "seed a pilot roster") | S each |
| B5 | **Reference material** (→ material) | `authoring/generatePanels.tsx:163,413` | S |
| B6 | **Activity** (→ step) | `generatePanels.tsx:772` | S |
| B7 | **Content** | `console/ClassDetail.tsx:395` | S |

And the terminology that is not retired but is not one word either:

| # | What | Where | Evidence | Cost |
|---|---|---|---|---|
| B8 | Step kinds are labelled Teach / Practice / Checkpoint / Reflect / Explain / Media. The lexicon names three beats: teach, check, practice. "Reflect", "Explain" and "Media" have no lexicon entry at all — the word list is behind the code, or the code is ahead of the words. Needs a decision, not just an edit. | `authoring/stepModel.tsx:48` | measured | S to relabel; the decision is yours |
| B9 | One toggle, three names: the student menu says **Theme** (Dark \| Light), the teacher menu says **Appearance** (Dark / Light), the sign-in page has a floating moon with neither. | `student/StudentApp.tsx` avatar menu; `teacher/shell/TeacherSidebar.tsx:236-241`; `routes/login.tsx:126` | looked at (x-1x-avatar-menu, q-2x), measured | S |
| B10 | **Sign out** (student) vs **Log out** (teacher). | student avatar menu; `TeacherSidebar.tsx:256` | looked at, measured | S |
| B11 | The sidebar's own labels differ by portal: teacher "Hide sidebar / Show sidebar / Open navigation", student "Expand sidebar / Collapse sidebar". Screen-reader users hear two products. | both shells | measured | S |
| B12 | Student Home has a **Home** segment and, under it, an **Overview** row — two names for one destination, and the row is the only thing under "CLASSES" until the student has a class. | `student/ClassList.tsx:53`; `StudentApp.tsx:445` | looked at (x-1x-overview) | S, if you agree it is two names |
| B13 | Admin copy speaks vendor: "Passwords are sent only to **Supabase Auth** and are not stored in **Jargon tables**"; the refresh button says **Refresh ops**. | `features/admin/AdminPage.tsx:311,325`; `admin/PeoplePanel.tsx:325-326` | looked at (d-30), measured | S |
| B14 | A raw database value reaches the teacher: "Grade 7 · latest status: `<status>`". | `console/StudentDetail.tsx:177` | measured | S |
| B15 | "RECENT ACTIVITY" heads the student Home. The lexicon retires *Activity* in the UI as the database word for a step; here it means recent doings. Same word, second sense — the exact thing the lexicon exists to prevent. Judgment call. | `student/StudentHome.tsx` | looked at (d-1x) | S |
| B16 | Two different components are both called `KnowledgeCard` (teacher, 395 lines; student, 164 lines). Not visible to a user; visible to the next person who greps. | `features/teacher/KnowledgeCard.tsx`, `student/KnowledgeCard.tsx` | measured | S |
| B17 | The student's Customize panel offers voices named **Marin, Cedar, Coral, Nova, Shimmer** — the speech provider's catalogue names, shown raw to a twelve-year-old. | `features/student/MentorControls.tsx:15` — looked at (q-13) | S — decision (name them in Jargon's voice, or keep) |
| B18 | The student Profile's third section is headed "CLASSES & PERFORMANCE". *Performance* is not a lexicon word; the lexicon's word for what teaching produces is *evidence*. | `student/ProfilePanel.tsx:270` — looked at (q-12) | S |

---

## C. Buttons, controls, states — the same thing drawn several ways

| # | What | Evidence | Cost |
|---|---|---|---|
| C1 | **286 buttons; 95 use the `.btn` system, 191 are bespoke.** DESIGN_V6 §8 says `.btn` is "the ONLY way to draw these controls". The bespoke ones cluster: Chatbox 14, generatePanels 10, and 7 each in ArtifactFrame, StepCard, AskJargon, AssessmentSurface, AssignmentSurface, Transcript. Variants in use: btn-sm 78, btn-secondary 68, btn-primary 16, btn-ghost 9, btn-danger 4, btn-icon 2. | measured | L for the whole app; M for the teacher files alone |
| C2 | **Refresh is drawn two ways**: icon-only with an aria-label (room panel "Refresh the room", CognitionPanel, KnowledgeCard) and icon-plus-word (admin "Refresh ops", SetupPanel, HealthPanel) — and the admin alone uses four words for it: "Refresh ops", "Recheck", "Refresh", "Refresh metrics". | measured, looked at (q-31) | S |
| C3 | One browser `window.confirm(...)` survives in class Settings (removing a section), while R47 retired browser prompts in favour of the two-click inline `ConfirmButton`. | `features/teacher/settings/ClassSettingsScreen.tsx:120`; `features/admin/ConfirmButton.tsx:3` | measured | S |
| C4 | **Empty states come three ways**: the `EmptyState` component (4 files), `EmptyInline` (2 files), and a hand-rolled "No … yet." paragraph (8 places). | measured | M to make it one |
| C5 | **Loading states come five ways**: `RouteLoader` ×25, `Loader2` ×53, `animate-spin` ×38, the word "Loading…" ×21, `Skeleton` ×2. One misuse is visible: the full-screen `RouteLoader` (with its ambient backdrop) renders *inside* the class card while the Course screen loads, so a gradient wash appears in the middle of a page that has none. | `features/teacher/course/CourseScreen.tsx:64` — looked at (d-23), measured | S for that one; M for a loading vocabulary |
| C6 | **Shadows**: seven variants, including raw Tailwind `shadow-sm` / `shadow-lg` / `shadow-md` where the tokens are `shadow-card` / `shadow-raised`. | `features/teacher/assist/AskJargon.tsx:218`; `student/ChatWindow.tsx:186` — measured | S |
| C7 | **Radii**: the tokens carry the app (`rounded-card` 159, `rounded-control` 101, `rounded-pill` 45, `rounded-full` 139) but 32 raw values remain (`rounded-md` 17, `rounded-2xl` 3, `rounded-lg` 3, `rounded-xl` 2, arbitrary 7). | measured | S |
| C8 | **Micro-labels are hand-assembled at every site.** `text-overline` is a font-size token only (10 px); uppercase, tracking and font are added by hand each time. 168 uppercase class strings carry seven different tracking values — 0.1em ×95, 0.08em ×35, 0.16em ×15, 0.14em ×10, 0.09em ×4, 0.06em ×4, 0.12em ×2 — and only 27 of the 168 are in the mono voice. The design boards say 0.16em. The app is not consistent with the boards, nor with itself. | measured | M — one recipe class, replace the sites |
| C9 | **Font sizes outside the scale**: 48 raw `text-[Npx]` values in TSX (13px ×9, 12.5px ×9, 22px ×5, 11px ×5, 15px ×4, 12px ×4, 10px ×3, and singles up to 46px). | measured | M |
| C10 | The Today digest's error state is a bare sentence inside the card with no way to retry. (Seen because the harness refuses the call; the rendering path is real.) | `features/teacher/ClassDigestCard.tsx` — looked at (d-21, l-21) | S |

Positive, measured: no Title-Case button labels anywhere (sentence case holds); `window.alert`
appears nowhere; no `console.log` and no TODO/FIXME in `frontend/src` or `supabase/functions`.

---

## D. Design rules — three sources disagree, and the app follows none of them fully

Three things claim to be the standard:

1. **Your standing preferences** (the profile): Inter + Geist Mono; letter-spacing 0 except
   the mono micro-label voice; no gradients; one dark scheme; hue is meaning, from a
   restrained five-hue set; borders uniform on all sides; selection is a blue wash.
2. **The repo's design system** (`docs/design-system/project/*.html`, `docs/DESIGN_V6.md`,
   `styles.css:8-15`): "Manrope everywhere; Geist Mono for code, counters, and timestamps";
   the boards use `letter-spacing: .16em` eleven times and `radial-gradient` sixteen times;
   DESIGN_V6 §8 prescribes hairline `border-t` for deeper grouping.
3. **The app as measured.**

Where they land:

| # | Rule | Profile | Boards / styles.css | App (measured) | Cost to reconcile |
|---|---|---|---|---|---|
| D1 | Typeface | Inter | Manrope (`--font-sans`, `--font-serif` both Manrope) | Manrope | L if Inter — every board redraws |
| D2 | Tracking | 0 except mono labels | .16em on labels, Manrope | 213 `tracking-*` uses, 181 on non-mono text; seven values (C8) | M either way, once decided |
| D3 | Gradients | none | radial washes ×16 | `.grad-text` (dead CSS), `.grad-border` via GradientCard→ModalCard, `.aurora-glow` in LessonTree and ClassList, radial washes on sign-in (l-00), the brain's node halos (R54, deliberate), the RouteLoader backdrop (C5) | S to delete the dead and incidental ones; sign-in and brain are decisions |
| D4 | Hues | five | — | seven semantic (`muted`, `primary`, `success`, `warning`, `danger`, `info`, `accent`) plus a raw `amber-400` leak ×2, plus the brain's curated set | S for the leak; the count is a decision |
| D5 | Borders | uniform, all sides | hairlines (`border-t`) for grouping | 68 one-sided borders (`border-b` 35, `border-t` 23, rest `-l/-r`) | Decision first; M after |
| D6 | Theme | one dark scheme | light + dark ladders (R53) | both shipped; light parity held on all 15 screens I compared | — (state it; no action implied) |
| D7 | Naming | — | — | `.font-serif` is bold, tight-tracked Manrope — a misnomer in 16 files | S |
| D8 | Shell | — | "three doors share the sidebar shell" (DESIGN_V6 §1) | admin is a top bar with a gear, no sidebar (d-30); student and teacher share the shell | L (R84 built the admin as a window on purpose — decision) |

I am not choosing between 1 and 2. I am saying the app cannot satisfy both, and today it
satisfies neither on D2 and D3.

---

## E. Redundancy — the same function written twice

| # | What | Where | Cost |
|---|---|---|---|
| E1 | Six helper pairs with the same name and job: `formatDate` (HealthPanel vs `lib/format`), `formatPercent` (HealthPanel vs `derive`), `formatScore` (classShared vs `lib/format`), `relativeTime` (NotificationsMenu vs `lib/format`), `statusLabel` (generatePanels vs `derive`), `uid` (chatMessages vs AskJargon). | measured | S each, M together |
| E2 | Eight CSS classes defined in `styles.css` and referenced nowhere: `bmap-glow`, `bmap-node`, `bmap-thread`, `dot-indicator`, `ds-soft`, `grad-text`, `shimmer-dot`, `tutor-beat` (checked against template-string use too). | measured | S |
| E3 | Three theme entry points (B9). | — | S |
| E4 | The teacher's Today digest is served by `admin-ops` (`lib/api.ts:1160` → `admin-ops/index.ts:3093`). It works — the teacher actions are dispatched before the admin gate — but a teacher screen depending on a function named `admin-ops` is a coupling the next person will trip on. | measured | M to move; S to leave and document |
| E5 | Three orphan edge functions still deployed in the project: `key-probe-oneoff`, `ops-probe-r49`, `deploy-probe-r90`. Deleting is one CLI line each; I do not hold the token. | R95 | S (yours) |
| E6 | 35 files export constants or helpers next to components (the eslint fast-refresh warnings). Costs hot reload only. | measured | M, nice-to-have |

---

## F. Failure to operate — where a real user could hit a wall

| # | What | Where | Evidence | Cost |
|---|---|---|---|---|
| F1 | The root route resolves the role with no catch: if `fetchPrimaryRole` throws (a network blip at sign-in), the route errors rather than falling back to `/login` or a role-less home. | `frontend/src/routes/index.tsx:9` | measured; consequence inferred | S |
| F2 | Only the student app has an error boundary. A render error in one teacher or admin panel reaches the router's root `errorComponent` and takes the whole route down instead of one panel. | `student/StudentApp.tsx:733` is the only `<ErrorBoundary>`; `routes/__root.tsx:79` | measured; consequence inferred | S–M |
| F3 | Stale instruction: the per-student Thinking tab still says "Nothing judged yet — Press Read the thinking and Jargon will judge this lesson's responses." Scoring has run itself every fifteen minutes since R92; the room panel already says so. A teacher is told to press something that no longer matters. | `console/CognitionPanel.tsx:194-195` | measured | S |
| F4 | The room panel at zero students prints the same sentence twice — headline and detail both "No students in this class yet." | `cognition/room.ts:118` and `cognition/ClassRoomPanel.tsx:220` | looked at (d-21, l-21), measured | S |
| F5 | The landing says "3 live now" for a class whose Today says two. The landing counts sessions unscoped; Today scopes them to lessons the class teaches. One fact, two numbers. | `console/derive.ts:97` vs `today/TodayScreen` | looked at (d-20 vs d-21), measured | S–M |
| F6 | Plurals: "all 1 lessons" (`generatePanels.tsx:486`), "1 of 1 lessons written" (`course/coursePanels.tsx:195-198`), aria "1 classes" (`StudentHome.tsx:479`), and the aria-labels at `LessonTree.tsx:144`, `ClassSummary.tsx:138`. | measured | S |
| F7 | `BrainGraph.tsx:993` reads a ref inside an effect cleanup (the one `exhaustive-deps` warning) — the classic stale-ref-on-unmount. | measured | S |
| F8 | Tab titles: only admin, platform, sign-in, teacher and lesson set one; every student screen and the class/student routes show plain "Jargon". Separators differ: "Sign in — Jargon" vs "Teacher - Jargon". | `routes/*.tsx` | measured | S |
| F9 | The web-app manifest paints `#fafaf9` for background and theme colour; the light ladder is `#ffffff` and the dark `#26262a`. The install splash is an older palette. | `frontend/public/manifest.webmanifest` | measured | S |
| F10 | Bundle: five chunks over 400 kB — AmbientCanvas 510 kB (three.js, loaded for the sign-in wash), StudentApp 473, stepModel 458, index 408, and a 268 kB lucide chunk fed by 82 importing files. Not a failure; a cost on school wifi. | build output | measured | M (lazy the canvas; icon audit) |
| F11 | `chat/index.ts` is 426 kB in one file. It now deploys only because #92 moved bundling server-side; it stays the single deploy hazard. | known since #92 | — | L to split |
| F12 | **Teachers have no in-app profile or password surface.** The student menu has Profile (preferred name, full name, new password, reset link); the teacher menu has Appearance and Log out only, and no teacher file mentions a password change or reset link. A teacher who wants a new password asks the admin. | `teacher/shell/TeacherSidebar.tsx:236-262`; grep across `features/teacher` | measured, looked at (q-2x vs q-12) | M — the student ProfilePanel's account block already exists |

---

## G. Copy — sentences a teacher or a school will read

| # | What | Where | Cost |
|---|---|---|---|
| G1 | "Manage pilot classrooms." / "Get a pilot ready…" head the admin. If this launch is past "pilot", the word is on the first admin screen. | `AdminPage.tsx` (d-30) | S — decision |
| G2 | Sign-in headline "Learn anything, in your own words." and "Hyper-personal lessons that meet you where you are." are marketing on a school sign-in page. Fine if that is the door's job; noted because a teacher signs in there every morning. | `routes/login.tsx` (d-00) | S — decision |
| G3 | The step-kind and lexicon items in §B are copy too — B1's dead pointer ("the class console's Resources tab") is the one a teacher will actually follow and fail. | — | — |

---

## H. Phone (390×844) — what I saw and what I measured

Seen (p-10, p-11, p-20, p-21, p-22): A3, A4, A5 above. Student Learn is otherwise usable at
phone width: the composer, mode pill, mic and voice orb all fit; the step chip truncates
its title, which is acceptable. The teacher landing fits except for the name shrink (A5).

Measured (walk 4, `scrollWidth` vs `innerWidth`, widest elements past the right edge):

| Screen | Page scrolls? | Widest element | Meaning |
|---|---|---|---|
| Class → Today | no (`scrollWidth` 390 = viewport) | the class card's inner `div.p-4` is **512 px** wide; each section inside (digest, room, "In a lesson now") **514 px**; the Watch button's right edge at **542 px** | the page clips instead of scrolling — everything past 390 px is unreachable, not merely awkward |
| Class → People | no | the roster grid is **678 px** wide (right edge 715 px); the remove-from-class button sits at 706 px | same: clipped, and the per-student section select and remove control are off-screen |
| Class → Course | no | the card is **515 px**; the shared-book notice's "Make a copy" button is cut mid-word | same |
| Teacher landing | no overflow | — | fits; only the name shrink (A5) |
| Student Home / Learn | no overflow | — | fits; only the menu-button overlap (A3) |

The common factor is the class card itself (514–515 px on all three tabs), so the fix is one
container, not three screens; the People roster (678 px) needs its own row treatment on top.
The earlier faded roster capture (p-22) did not reproduce on re-capture with a longer settle
— a transition state, not a defect.

---

## I. Admin portal

Seen: the organisation picker (d-30). It has the vendor copy (B13), the "Refresh ops" label
(B13), the "pilot" heading (G1), and a different chrome from the two other portals (D8).

Seen in walk 4 (q-31, q-32-setup/people/classes/health), all as an organisation admin:

| # | What | Where | Cost |
|---|---|---|---|
| I1 | Setup reads well: a per-class checklist, worst first, "Recheck". Its item "Work/resources prepared" carries a retired word (added to B1). | `features/admin/SetupPanel.tsx:57` | S |
| I2 | People: a directory with role/status/class filters and "Import a roster". Every row's only action is **Manage** — ten identical generic verbs on one screen, none naming what will be managed. | `features/admin/PeoplePanel.tsx` | S — decision |
| I3 | Classes: "New classes start empty — add teachers and students from People, or **seed** a roster" and "**seed** a pilot roster" (added to B4). | `features/admin/ClassesPanel.tsx:147,188` | S |
| I4 | Health's audience sentence is keyed to the data, not the reader: it says "**Platform admins** see estimated model cost…" whenever cost figures are visible, and "Org admins see scoped usage…" when they are not. In the walk the mock exposed costs to an organisation admin, so the sentence described someone else; in production the gate (`costVisible`) should hide that branch from org admins — I did not verify the live gate. | `features/admin/HealthPanel.tsx:288-291` — looked at (q-32-health); production behaviour inferred | S |
| I5 | Health's errors metric renders count and rate in one value: "2 · 2%". | `HealthPanel.tsx:335` | S |
| I6 | Health's three breakdown tables paint their scroll-fade covers even when empty and not overflowing — dark vertical bars beside each header row. | `styles.css:687-694` (`.table-scroll`), looked at | S |
| I7 | Four labels for refreshing on the one portal: "Refresh ops", "Recheck", "Refresh", "Refresh metrics" (folded into C2). | — | S |
| I8 | The admin shows no signed-in identity on the page; it lives inside the gear menu (`SettingsMenu`), where the other two portals put an avatar and email in the sidebar foot. | `AdminPage.tsx:495` | S — decision |

---

## J. Accessibility and contrast

| # | What | Evidence | Cost |
|---|---|---|---|
| J1 | **Muted text does not reach AA at the sizes it is used.** Computed from the tokens in `styles.css`: light `#7c7c83` on white = 4.14:1, on `depth-sub` = 3.81:1; dark `#8a8a8a` on the page = 4.37:1, on cards = 3.80:1, on sub-surfaces = 3.42:1. AA for small text is 4.5:1; meta is 11.5 px and overline 10 px. Primary buttons: white on `#4f6bfd` = 4.33:1 (light), on `#5f76fd` = 3.82:1 (dark). Body text is fine (13.3:1 / 12.1:1). | measured (computed) | S to nudge the two tokens; a palette decision |
| J2 | Icon-only buttons: a scan of all 286 flagged 17 without a visible label; reading each, all 17 carry their label in a JSX expression. **None found without an accessible name.** | measured, then read | — |
| J3 | `focus-visible` styling appears 8 times; `prefers-reduced-motion` / `motion-reduce` guards 8 times against 10 `animate-ping` / `animate-pulse` uses. DESIGN_V6 §1 says every animation respects reduced motion; I did not verify each of the ten. | measured; coverage inferred | S to check |

---

## K. Toolchain hygiene

| # | What | Cost |
|---|---|---|
| K1 | `npm run lint` is `eslint .`; it had not finished after fifteen minutes and I stopped it. `eslint src` finishes in a few minutes with the 36 warnings above. The config ignores `dist`, `.output`, `.vinxi` — whatever it was walking under `frontend/` besides `src`, I did not establish. | S to point the script at `src` (or find the directory) |
| K2 | `routeTree.gen.ts` is hand-maintained (no router plugin) — documented in `routes/README.md`; a known sharp edge, not a defect. | — |

---

## L. Cost roll-up, and three natural bundles

Counting the rows above by cost: **S ×57**, **M ×9**, **L ×4** (5 rows carry no cost — they are
statements or your call), plus the items that are decisions before they are work (B8, B17, D1–D5, D8, G1, G2, I2, I8).

If it helps to pick by shape rather than by row — offered, not recommended:

- **Before the first school sees it** — A1, A2, A3, A5, B13, F3, F4, F6, I4, B1's dead pointer.
  All S; about one day including pins.
- **Phone day** — A4 with the measured widths in §H (one container plus the roster row),
  then a re-walk of the five phone screens. M.
- **One vocabulary** — the §B decisions (B8 first), then C1 (teacher files), C4, C5, C8, C9.
  L: three to five days, and it touches most files, so it wants its own PR per screen.

Everything else stands on its own row.

---

## What I did not do

No code was changed in this round beyond this document and the handoff entry. Every count
above is reproducible from the commit named at the top; every screenshot name refers to the
session's scratchpad captures. Where I say *inferred*, I have not run it.
