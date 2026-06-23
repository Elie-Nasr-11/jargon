from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "0010_voice_realtime.sql"
VOICE_FUNCTION = ROOT / "supabase" / "functions" / "voice-session" / "index.ts"


class VoiceRealtimeMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = MIGRATION.read_text(encoding="utf-8")
        cls.lowered = cls.source.lower()
        cls.function_source = VOICE_FUNCTION.read_text(encoding="utf-8")

    def test_realtime_and_audio_cache_tables_are_private(self):
        for table in ("voice_realtime_sessions", "voice_audio_cache"):
            with self.subTest(table=table):
                self.assertIn(f"create table if not exists public.{table}", self.lowered)
                self.assertIn(f"alter table public.{table} enable row level security", self.lowered)
                self.assertIn(f"revoke all privileges on table public.{table} from anon", self.lowered)
                self.assertIn(f"grant select, insert, update, delete on public.{table} to service_role", self.lowered)

    def test_voice_events_include_realtime_without_raw_audio(self):
        for event_type in (
            "voice_session_started",
            "voice_session_ready",
            "voice_session_ended",
            "voice_turn_submitted",
            "voice_tool_result",
            "read_aloud_cached",
        ):
            with self.subTest(event_type=event_type):
                self.assertIn(event_type, self.source)

        for forbidden in ("raw_audio", "audio_blob", "audio_bytes", "recording_path"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, self.lowered)

    def test_private_audio_cache_bucket_exists(self):
        self.assertIn("'mentor-audio-cache', 'mentor-audio-cache', false", self.source)
        self.assertIn("array['audio/mpeg']", self.source)

    def test_edge_function_keeps_openai_key_server_side(self):
        self.assertIn('Deno.env.get("OPENAI_API_KEY")', self.function_source)
        self.assertIn("https://api.openai.com/v1/realtime/calls", self.function_source)
        self.assertIn("https://api.openai.com/v1/audio/speech", self.function_source)
        self.assertIn("OpenAI-Safety-Identifier", self.function_source)
        self.assertIn("submit_voice_turn", self.function_source)


if __name__ == "__main__":
    unittest.main()
