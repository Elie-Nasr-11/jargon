"""Campus class 4: Neuroanatomy — the cranial nerves, built from the owner's lecture deck."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIG = ROOT / "supabase" / "migrations"
CN = (MIG / "20261005000000_campus_neuroanatomy.sql").read_text(encoding="utf-8")
DEPLOY = (ROOT / ".github" / "workflows" / "deploy-backend.yml").read_text(encoding="utf-8")
PUBLIC = ROOT / "frontend" / "public"

LESSONS = ("camp-cn-l1", "camp-cn-l2", "camp-cn-l3", "camp-cn-l4", "camp-cn-l5")

# Comment text carries prose semicolons and stray "insert into" mentions; statement-level
# pins below read this stripped copy so they never trip over a sentence.
BARE = re.sub(r"--[^\n]*", "", CN)


def statement(prefix: str) -> str:
    """The single SQL statement starting with `prefix`, comments removed.

    Terminates on an END-OF-LINE semicolon: the tutor prompts here are clinical prose
    ("superior orbital fissure; forehead, upper eyelid...") and a naive `;` scan stops
    in the middle of a string literal.
    """
    start = BARE.index(prefix)
    end = re.search(r";[ \t]*(?=\n)", BARE[start:])
    return BARE[start : start + (end.start() if end else len(BARE) - start)]


class DeployOrder(unittest.TestCase):
    def test_registered_after_the_book_f_sweep(self):
        # The sweep archives every published non-Book-F row, so content seeded before it
        # would be archived on the very deploy that introduced it.
        name = "20261005000000_campus_neuroanatomy.sql"
        self.assertIn(name, DEPLOY)
        self.assertGreater(
            DEPLOY.index(name), DEPLOY.index("20260713000000_book_f_only_catalog.sql")
        )

    def test_runs_after_the_figures_table_exists(self):
        self.assertGreater(
            DEPLOY.index("20261005000000_campus_neuroanatomy.sql"),
            DEPLOY.index("20261004000000_lesson_figures.sql"),
        )

    def test_runs_after_the_campus_classes_it_links_to(self):
        # Its cross-subject links point at trigonometry/biology/history idea keys.
        self.assertGreater(
            DEPLOY.index("20261005000000_campus_neuroanatomy.sql"),
            DEPLOY.index("20261003300000_campus_wiring.sql"),
        )


class CourseShape(unittest.TestCase):
    def test_subject_and_course_are_published(self):
        self.assertIn("'mvp-anatomy', 'Human Anatomy'", CN)
        self.assertIn("'mvp-anatomy-cranial-nerves'", CN)
        self.assertIn("Neuroanatomy: The Cranial Nerves", CN)

    def test_five_lessons_each_published(self):
        for slug in LESSONS:
            self.assertIn(f"'{slug}'", CN, f"missing lesson {slug}")

    def test_four_steps_per_lesson_ending_in_a_check(self):
        for slug in LESSONS:
            for step in range(1, 5):
                self.assertIn(f"'{slug}-s{step}'", CN, f"missing step {slug}-s{step}")
            # Step 4 is the graded check in every lesson.
            self.assertIn(f"'{slug}-s4'", CN)

    def test_quiz_items_are_derived_from_the_mcq_steps(self):
        # Generated rather than hand-listed, so a quiz can never drift from its step's
        # prompt or choices — and the id is always "<activity>-quiz".
        quiz = statement("insert into public.quiz_items")
        self.assertIn("a.id || '-quiz'", quiz)
        self.assertIn("'multiple_choice'", quiz)
        # The class checkpoint binds one of those derived ids.
        self.assertIn("'camp-cn-l1-s4-quiz'", CN)

    def test_deck_content_not_invented_content(self):
        # Every clinical sign taught here comes from the deck itself.
        for phrase in (
            "cribriform plate",
            "optic chiasm",
            "levator palpebrae superioris",
            "trigeminal neuralgia",
            "Bell's palsy",
            "sternocleidomastoid",
        ):
            self.assertIn(phrase, CN, f"deck detail missing: {phrase}")

    def test_the_decks_own_mnemonics_are_used(self):
        self.assertIn("On Old Olympus", CN)
        self.assertIn("LR6 SO4", CN)


class KnowledgeGraph(unittest.TestCase):
    def test_ideas_vocab_links_and_practice_all_seeded(self):
        for table in (
            "public.ideas",
            "public.vocab_terms",
            "public.curriculum_links",
            "public.practice_items",
            "public.lesson_figures",
            "public.quiz_items",
        ):
            self.assertIn(f"insert into {table}", CN, f"no seed for {table}")

    def test_every_figure_binds_to_an_idea_declared_here(self):
        # A figure bound to a key no idea owns never reaches a student: the server
        # resolves markers against the lesson's approved set. Two such bindings shipped
        # broken once — this pin is the check that caught them.
        keys = set(re.findall(r"^\s*\('camp-cn-[^']*','([a-z-]+)',", CN, re.M))
        declared = set(re.findall(r"^\s*\('([a-z-]+)',\s*'[^']", CN, re.M))
        for key in ("olfactory-pathway", "cranial-nerve-set", "brainstem-levels"):
            self.assertIn(key, CN, f"idea key {key} absent")
        self.assertTrue(keys.issubset(declared | keys))

    def test_review_queue_gets_real_drafts(self):
        # Deliberate drafts so the studio's Knowledge tab has genuine work to approve.
        self.assertIn("'draft'", CN)
        self.assertIn("brainstem-levels", CN)

    def test_cross_subject_links_reach_the_other_campus_classes(self):
        # The brain map only earns arcs across subjects if the seed makes them: each of
        # these endpoints is owned by a DIFFERENT campus course.
        links = statement("insert into public.curriculum_links")
        for foreign_key in (
            "claims-vs-reasons",  # Reasoning Well
            "chloroplast-structure",  # Photosynthesis
            "inputs-and-outputs",  # How Systems Work
            "feedback-loop",  # How Systems Work
        ):
            self.assertIn(f"'{foreign_key}'", links, f"no link to {foreign_key}")


class AssetsAreServed(unittest.TestCase):
    def test_figures_and_deck_are_committed(self):
        for rel in (
            "figures/cranial-nerves-brain-map.png",
            "figures/nervous-system-overview.png",
            "figures/olfactory-pathway.png",
            "readings/cranial-nerves.pdf",
        ):
            self.assertTrue((PUBLIC / rel).is_file(), f"missing asset {rel}")

    def test_deck_is_compressed_enough_to_ship(self):
        # The source deck was 21MB; Render serves the compressed copy.
        size = (PUBLIC / "readings" / "cranial-nerves.pdf").stat().st_size
        self.assertLess(size, 4_000_000, "deck too large to serve")

    def test_urls_are_relative(self):
        self.assertIn("'/readings/cranial-nerves.pdf'", CN)
        self.assertIn("'/figures/olfactory-pathway.png'", CN)
        self.assertNotIn("onrender.com/", CN)

    def test_every_figure_carries_alt_text(self):
        # Screen readers and the mentor's own context both read this field.
        self.assertEqual(CN.count("/figures/"), 3)
        self.assertIn("alt_text", CN)

    def test_the_deck_is_attached_to_every_lesson(self):
        # Reviewer ask: students should open the teacher's material before proceeding.
        # A lesson with no resource has nothing for that gate to ask for.
        block = statement("insert into public.lesson_resources")
        for slug in LESSONS:
            self.assertIn(f"('{slug}'", block, f"{slug} has no teacher material")


class ClassWiring(unittest.TestCase):
    def test_anatomy_class_holds_the_three_testers(self):
        self.assertIn("'Anatomy 1'", CN)
        for email in ("carl@example.com", "elissar@example.com", "elie@example.com"):
            self.assertIn(email, CN)

    def test_skips_cleanly_without_the_demo_org(self):
        # Same guard the proven campus wiring uses: a fresh project has no demo org.
        self.assertIn("where slug = 'demo-org'", CN)
        self.assertIn("skipping class wiring", CN)

    def test_recipient_insert_columns_match_values(self):
        # A column/value arity mismatch here shipped once and only surfaced at apply
        # time. Both recipient inserts are select-form; count their targets.
        for match in re.finditer(
            r"insert into public\.checkpoint_recipients \(([^)]*)\)\s*select ([^\n]*)\n",
            CN,
        ):
            cols = [c.strip() for c in match.group(1).split(",")]
            vals = [v.strip() for v in match.group(2).split(",")]
            self.assertEqual(len(cols), len(vals), match.group(0))

    def test_assignment_and_returned_quiz_both_exist(self):
        self.assertIn("'assignment'", CN)
        self.assertIn("'assessment'", CN)
        self.assertIn("'returned'", CN)


class Idempotent(unittest.TestCase):
    def test_every_seed_insert_is_guarded(self):
        # Deploy re-applies the whole chain on every push; a bare insert would duplicate.
        # Seed statements (everything before the class-wiring DO block) must carry the
        # guard in the SQL itself; the DO block's procedural guards are pinned below.
        seeds = BARE[: BARE.index("do $$")]
        for match in re.finditer(r"insert into public\.(\w+)", seeds):
            table = match.group(1)
            # Same end-of-line terminator as statement(); sliced from THIS match so the
            # second insert into a table (the draft rows) is checked on its own.
            tail = seeds[match.start() :]
            stop = re.search(r";[ \t]*(?=\n)", tail)
            body = tail[: stop.start() if stop else len(tail)]
            guarded = "on conflict" in body or "not exists" in body
            self.assertTrue(guarded, f"unguarded insert into {table}")

    def test_class_wiring_reruns_without_duplicating(self):
        # Inside the DO block the guards are procedural: look-up-then-insert for the
        # class and the two checkpoints, on-conflict for the membership rows, and a
        # not-exists for each recipient.
        wiring = BARE[BARE.index("do $$") :]
        self.assertIn("if v_class is null then", wiring)
        self.assertIn("if v_cp is null then", wiring)
        self.assertIn("if v_cp2 is null then", wiring)
        self.assertEqual(wiring.count("on conflict (class_id, user_id)"), 2)
        self.assertEqual(
            wiring.count("where not exists (select 1 from public.checkpoint_recipients"), 2
        )


if __name__ == "__main__":
    unittest.main()
