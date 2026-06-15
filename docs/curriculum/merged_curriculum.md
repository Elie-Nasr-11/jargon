# Merged Jargon Curriculum

Audience: mixed. Lessons should carry level labels so middle-school beginners, high-school bridge learners, and teacher-facing curriculum users can share the same platform without flattening the experience.

Level labels:

- Level 0: Natural Logic - explain the process in plain language.
- Level 1: Pseudocode - use structured steps, IF, REPEAT, and END without requiring exact syntax.
- Level 2: Jargon - write runnable Jargon programs.
- Level 3: Python Bridge - compare the Jargon idea to Python syntax when the learner is ready.

## Module 1: Processes

Goal: Build structured thinking from real systems before writing code.

Deployed lesson mapping:

| Deployed Lesson | Curriculum Fit | Suggested Levels |
| --- | --- | --- |
| Purpose | Module 1, Lesson 1: What Is a Process? | Level 0 -> Level 1 |
| Systems & Signals | Module 1, Lesson 2: From Signals to Meaning | Level 0 -> Level 1 |
| Signal Processing | Module 1, Lessons 2 and 7: signal flow and process mapping | Level 0 -> Level 1 |
| Memory | Module 1, Lesson 3: Structuring Storage | Level 0 -> Level 2 |
| Exchanging Signals | Module 1, Lessons 7 and 8: systems around you | Level 0 -> Level 1 |

## Module 2: Coding

Goal: Turn structured thinking into runnable Jargon.

Recommended sequence:

1. Turn a process into code - sequence and PRINT.
2. Variables remember things - SET.
3. Decisions and comparisons - IF / ELSE / END.
4. Lists and looping - lists, indexes, REPEAT_UNTIL.
5. Inputs and outputs - ASK and PRINT.
6. Final logic lab - combine variables, lists, conditions, loops, and ASK.

Curated examples in `examples/` should be used here first, with `legacy/examples/` as the wider practice bank.

## Module 3: Prompting

Goal: Teach students to interact with intelligent systems using clear intent and constraints.

Mentor role:

- Start with natural speech.
- Ask the learner to clarify steps.
- Translate the steps into pseudocode.
- Translate pseudocode into Jargon.
- Bridge to Python only after the Jargon logic is sound.

## Product Rule

The Mentor is a teaching layer over deterministic runtime execution. It should coach, explain, and compare, but it should not be the source of truth for whether Jargon code runs.
