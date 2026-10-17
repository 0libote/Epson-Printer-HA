import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "smoke_api", Path(__file__).resolve().parents[2] / "scripts" / "smoke-api.py"
)
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class SmokeApiTests(unittest.TestCase):
    def test_job_response_cannot_select_another_api_path(self):
        for job_id in ("../settings", "a" * 12 + "/cancel", "a" * 12 + "?q=x", "https://example.com", "a" * 12 + "\n", None):
            with self.subTest(job_id=job_id), self.assertRaises(ValueError):
                smoke.job_path(job_id)
        self.assertEqual(smoke.job_path("012345abcdef"), "/api/scan/jobs/012345abcdef")


if __name__ == "__main__":
    unittest.main()
