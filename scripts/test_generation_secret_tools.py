import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
EXPORT_MODULE_PATH = Path(__file__).with_name("export_myshell_chrome_cookies.py")
CONFIGURE_SCRIPT = Path(__file__).with_name("configure_generation_secrets.sh")

spec = importlib.util.spec_from_file_location("export_myshell_chrome_cookies", EXPORT_MODULE_PATH)
export_myshell_chrome_cookies = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(export_myshell_chrome_cookies)


class GenerationSecretToolsTest(unittest.TestCase):
    def test_cookie_dedupe_keeps_secret_values_out_of_summary_shape(self) -> None:
        cookies = export_myshell_chrome_cookies._dedupe(
            [
                {"domain": ".myshell.ai", "path": "/", "name": "session", "value": "first"},
                {"domain": ".myshell.ai", "path": "/", "name": "session", "value": "second"},
            ]
        )

        self.assertEqual(len(cookies), 1)
        summary = {
            "status": "ready",
            "cookieCount": len(cookies),
            "profiles": [{"profile": "Default", "cookieCount": len(cookies)}],
        }
        self.assertNotIn("value", json.dumps(summary))
        self.assertNotIn("second", json.dumps(summary))

    def test_configure_generation_secrets_dry_run_redacts_values(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            init_data = "query_id=fake&user=%7B%22id%22%3A1%7D&auth_date=1700000000&hash=fakehash"
            cookies = '[{"name":"session","value":"super-secret-cookie","domain":".myshell.ai","path":"/","secure":true}]'
            init_path = temp_path / "init.txt"
            cookies_path = temp_path / "cookies.json"
            init_path.write_text(init_data, encoding="utf-8")
            cookies_path.write_text(cookies, encoding="utf-8")

            completed = subprocess.run(
                [
                    str(CONFIGURE_SCRIPT),
                    "--init-data-file",
                    str(init_path),
                    "--cookies-file",
                    str(cookies_path),
                    "--no-deploy",
                    "--no-smoke",
                ],
                cwd=REPO_ROOT,
                check=True,
                capture_output=True,
                text=True,
            )

        combined = completed.stdout + completed.stderr
        self.assertIn("[dry-run]", combined)
        self.assertIn("validated 1 MyShell cookies", combined)
        self.assertNotIn("super-secret-cookie", combined)
        self.assertNotIn("fakehash", combined)


if __name__ == "__main__":
    unittest.main()
