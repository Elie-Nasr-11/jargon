from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
FN = ROOT / "supabase" / "functions" / "submission-maintenance" / "index.ts"
MIGRATION = ROOT / "supabase" / "migrations" / "20260728000000_submission_retention_scan.sql"
DEPLOY = ROOT / ".github" / "workflows" / "deploy-backend.yml"
CRON = ROOT / ".github" / "workflows" / "submission-maintenance.yml"
API = ROOT / "frontend" / "src" / "lib" / "api.ts"
TYPES = ROOT / "frontend" / "src" / "lib" / "types.ts"


class SubmissionMaintenanceStaticTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fn = FN.read_text(encoding="utf-8")
        cls.migration = MIGRATION.read_text(encoding="utf-8")
        cls.deploy = DEPLOY.read_text(encoding="utf-8")
        cls.cron = CRON.read_text(encoding="utf-8")
        cls.api = API.read_text(encoding="utf-8")
        cls.types = TYPES.read_text(encoding="utf-8")

    def test_edge_fn_is_system_only(self):
        # The sole trusted caller is the service-role key presented as the bearer token.
        self.assertIn("config.authorization !== `Bearer ${config.serviceRoleKey}`", self.fn)
        self.assertIn('"Forbidden."', self.fn)

    def test_edge_fn_has_the_three_actions(self):
        for fragment in (
            'action === "scan"',
            'action === "retention"',
            'action === "sweep"',
            "async function runScan",
            "async function runRetention",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.fn)

    def test_scan_without_provider_marks_skipped_and_errors_stay_pending(self):
        # No provider -> drain pending as 'skipped' (unscanned, still readable).
        self.assertIn("if (!config.scanApiUrl)", self.fn)
        self.assertIn('scan_status: "skipped"', self.fn)
        # A provider error must NOT mark bytes clean; the row stays pending for a retry.
        self.assertIn("errors += 1", self.fn)

    def test_retention_purges_by_age_and_tombstones(self):
        self.assertIn("SUBMISSION_RETENTION_DAYS", self.fn)
        self.assertIn("purged_at", self.fn)
        self.assertIn("deleteStorageObject", self.fn)
        self.assertIn("/storage/v1/object/", self.fn)

    def test_migration_adds_scan_dimension_and_tightens_read_policy(self):
        for fragment in (
            "add column if not exists scan_status text not null default 'pending'",
            "add column if not exists purged_at timestamptz",
            "assignment_submission_files_scan_status_check",
            "check (scan_status in ('pending', 'clean', 'quarantined', 'skipped'))",
            "Students and teachers can read submission files",
            "sf.scan_status <> 'quarantined'",
            "sf.purged_at is null",
        ):
            with self.subTest(fragment=fragment):
                self.assertIn(fragment, self.migration)

    def test_deploy_wires_migration_and_function(self):
        self.assertIn("20260728000000_submission_retention_scan.sql", self.deploy)
        self.assertIn("supabase functions deploy submission-maintenance", self.deploy)
        self.assertIn("supabase/functions/submission-maintenance/**", self.deploy)

    def test_cron_calls_the_sweep_as_the_system_caller(self):
        self.assertIn("/functions/v1/submission-maintenance", self.cron)
        self.assertIn('{"action":"sweep"}', self.cron)
        self.assertIn("Bearer ${SUPABASE_SERVICE_ROLE_KEY}", self.cron)

    def test_frontend_carries_scan_state(self):
        self.assertIn("SubmissionScanStatus", self.types)
        self.assertIn("scan_status: SubmissionScanStatus", self.types)
        self.assertIn("purged_at: string | null", self.types)
        self.assertIn("export function submissionFileState", self.api)


if __name__ == "__main__":
    unittest.main()
