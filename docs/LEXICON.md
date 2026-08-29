# The Jargon lexicon

One word, one meaning (rebuild brief, Law 3). This file is the arbiter. If a
screen, a button, a table or a comment uses a word from the retired list, it is
a defect — not a style preference.

Written 2026-08-29 as step 0 of the teacher console rebuild, which the brief
blocks all new UI work behind. Vocabulary drift is failure mode 10: "Content"
came to mean the room, the resources AND the linked courses; "material" meant
uploads, reference text and book PDFs. When one word means three things, no
layout can rescue it.

## The object model

    School
     └─ Class ──────────── teachers, students, sections
         ├─ Course        (what this class teaches — usually one)
         │   └─ Unit      (a chapter)
         │       └─ Lesson
         │           ├─ Step        (a beat: teach / check / practice)
         │           ├─ Work        (assignment or quiz → specific students)
         │           └─ Material    (file or link, from the book or added)
         └─ Evidence      (derived: mastery, ideas, vocabulary, digests)

Everything a teacher does is CRUD on exactly one node of that tree. A screen
that does not map to a node should not exist.

## The words

| Word | Means, exactly | Never means |
|---|---|---|
| **School** | The organization. Owns people and classes. | A campus, a site, a tenant. |
| **Class** | A group of students taught by a teacher, for one course. | The course itself. |
| **Section** | A grouping of students *within* a class. | A page region — use "panel" or name the screen. |
| **Course** | What a class teaches: an ordered set of units. | A lesson, a subject, a book. |
| **Unit** | A chapter of a course: an ordered set of lessons. | A module, a topic, a section. |
| **Lesson** | One taught session. The thing a student opens. | An activity, a module. |
| **Step** | One beat inside a lesson: teach, check, or practice. | An activity, a task, a stage. |
| **Work** | An assignment or a quiz, assigned to named students. | Classwork, homework, task. Prefer the specific word — "assignment", "quiz" — and use "work" only for the pair. |
| **Assignment** | Work a student submits for marking. | A quiz. |
| **Quiz** | Work with questions and answers, graded by rule or by teacher. | An assessment, a checkpoint, a test. |
| **Material** | A file or link attached to a class, unit, lesson or step. | Content, resource, media, reference. |
| **Book** | A source document a course was built from, with page ranges. | Material — a book is a *kind* of material, named when the source matters. |
| **Evidence** | Anything derived from student work: mastery, ideas, vocabulary, digests. | Analytics, data, insights. |
| **Publish** | Make a lesson visible to students. | Assign, release, share. |
| **Draft** | Not yet published. A state, never a verb in the UI. | A proposal from the assistant — that is "proposed". |

## Retired words

| Retired | Why | Say instead |
|---|---|---|
| **Content** (as a noun) | Meant the room, the resources, and the linked courses at once. | The specific object: course, lesson, material. |
| **Resource** (in the UI) | Same object as material, different word by screen. | Material. (`lesson_resources` stays as the table name; the UI does not say it.) |
| **Linked content** | Named neither the object (courses) nor the action. | "Courses in this class". |
| **Shared content** | Ambiguous between a course and a file. | "Shared course" or "shared material". |
| **Classwork** | Overlapped work, steps and materials. | Work — or the specific word. |
| **Seeding** | A database word bundling demo logins, class creation and roster import. | Name the job being done. |
| **Reference material** | A second name for material, scoped to one panel. | Material. |
| **Activity** (in the UI) | The database name for a step. | Step. (`lesson_activities` stays as the table name.) |

## Rules that follow from the words

1. **One home per object.** Every object is created in exactly one place, edited
   in exactly one place, and appears elsewhere only as a reference to that place.
2. **Creation names its target.** No generic "+ Create". A button says "Add a
   step to this lesson" and lives on the lesson.
3. **Derived things are outputs.** Evidence — ideas, vocabulary, mastery — is
   produced by teaching. It is never a field in an authoring form. It appears
   where it is read, not where it is made.
4. **Copy is part of the feature.** Deleting a feature means deleting every
   sentence that mentions it.
