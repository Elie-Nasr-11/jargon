# Voice Interaction Plan

Status: Voice v1 accepted; Voice v2 upgrades audio quality with OpenAI-backed read-aloud and live voice sessions.

## Goal

Students should be able to move through a lesson by speaking and listening, not only by typing. Voice is part of the private-tutor feel: a student can dictate answers, hear Mentor replies, and eventually run a hands-free guided session where the same curriculum, quiz, assignment, evidence, and teacher oversight contracts still apply.

Voice must not become a separate product path. It is another way to use the same lesson runtime.

## Modes

### Dictation Mode

Student taps a microphone, speaks, sees a transcript appear in the composer, edits if needed, and submits.

Rules:

- Works for normal text answers.
- Works for short reflections.
- Can be disabled during quizzes if the teacher wants silent or typed assessment.
- The submitted answer is the transcript unless audio-answer storage is explicitly enabled later.
- The UI should show when speech is still being transcribed and when confidence is low.

### Read-Aloud Mode

Mentor replies can be read aloud to the student.

Rules:

- Student can toggle read-aloud on/off.
- Teacher/class settings can allow or disallow it.
- The text remains visible for accessibility and review.
- Playback controls should include play, pause, replay, and speed.

### Audio Session Mode

The lesson becomes a guided listen-and-speak session:

1. Mentor speaks a short turn.
2. Student responds by voice.
3. The spoken answer is transcribed and auto-submitted as `input_modality: "audio_session"`.
4. The normal typed chat envelope continues the lesson.
5. Mentor speaks the approved orchestrator reply aloud.

Rules:

- Same lesson stages and guardrails apply.
- Mentor still asks for one next action at a time.
- Code activities should still switch to a code editor, but a student can ask questions by voice.
- In-chat quizzes should still take over the chatbar; voice can be allowed only if the quiz/rubric permits it.

## Privacy And Storage Defaults

Because the first audience is school children:

- Do not store raw student audio by default.
- Store the final transcript, modality metadata, timestamps, and optional confidence scores.
- Raw audio storage requires an explicit org/class setting, retention policy, and teacher/admin visibility rules.
- LLM calls should receive text transcripts, not raw identifiable audio, unless a future approved mode requires speech-to-speech processing.
- Audit when voice features are enabled, disabled, or used in an assessment.

## Teacher Controls

Teachers should be able to configure voice per class and per activity:

- allow dictation
- allow read-aloud
- allow audio session mode
- allow voice during quizzes
- require transcript confirmation before submit
- set classroom mode: quiet, headphones, or open audio
- disable voice for exams or sensitive activities

Teacher dashboards should show:

- answer modality: typed, dictated, audio session, code, file, or multiple choice
- transcript used for grading
- low-confidence transcription flags
- whether a student edited the transcript before submitting

## Accessibility

Voice supports:

- younger students who speak more easily than they type
- students with typing difficulties
- review/listening mode
- language-learning and pronunciation use cases later

Voice must not replace text:

- all spoken content remains visible as text
- all voice controls have keyboard alternatives
- captions/transcripts remain available

## Suggested V1 Implementation

Frontend first:

- Add a microphone button to the composer.
- Use browser speech recognition where available for dictation.
- Fall back gracefully when browser support is missing.
- Add read-aloud using browser speech synthesis for Mentor replies.
- Add student settings for dictation/read-aloud.
- Send `input_modality: "dictated"` when a dictated transcript is submitted.

Backend contract:

- Extend typed chat answers with optional modality metadata:

```ts
answer: {
  mode: "text" | "code" | "multiple_choice" | "file";
  text?: string;
  code?: string;
  choice_id?: string;
  run_result?: unknown;
  input_modality?: "typed" | "dictated" | "audio_session";
  transcript_confidence?: number;
}
```

- Persist modality metadata in turn/attempt payloads without changing grading semantics.
- Do not add raw audio storage in the first voice pass.

Database groundwork:

- Add voice settings to profile/class preference JSON where possible first.
- Add explicit tables later if usage/audit needs grow:
  - `voice_interaction_events`
  - `voice_preferences`
  - `speech_usage_events`

## Voice V2 Backend Speech Services

Browser speech APIs are enough for a demo but not a full product guarantee. Voice V2 adds a backend speech layer:

- OpenAI Realtime over WebRTC for live voice sessions
- a `submit_voice_turn` bridge so the existing Supabase `chat` orchestrator remains the source of truth
- text-to-speech with selected voices and private Mentor-audio caching
- cost tracking per transcription/synthesis event
- language/accent support
- pronunciation/scoring capabilities if needed

Raw student audio remains unstored by default.

Model/provider choices should be verified against current pricing, latency, safety, and data-handling policies before implementation.

## Acceptance Criteria

First voice slice:

- Student can dictate a text answer.
- Transcript appears before submission.
- Student can edit the transcript.
- Submitted turn records `input_modality: "dictated"`.
- Mentor replies can be read aloud.
- Voice can be disabled by setting.
- If browser speech recognition is unavailable, the UI remains fully usable by typing.

Full audio-session slice:

- Student can complete a discussion lesson mainly by listening and speaking.
- The system records transcript, modality, confidence, and timestamps.
- Teacher can see that the answer was dictated.
- No raw student audio is stored by default.
- In-chat quiz and code modes still behave correctly.
