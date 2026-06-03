import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("export_myshell_chrome_cookies.py")
spec = importlib.util.spec_from_file_location("export_myshell_chrome_cookies", MODULE_PATH)
exporter = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(exporter)


class ExportMyShellChromeCookiesTest(unittest.TestCase):
    def test_summary_reports_cookie_names_without_values(self) -> None:
        summary = exporter._summary_from_export_result(
            {
                "status": "ready",
                "cookieCount": 2,
                "profiles": [
                    {
                        "profile": "Default",
                        "cookieCount": 2,
                        "domains": [".myshell.ai"],
                        "cookieNames": ["privy-session", "privy-token"],
                    }
                ],
                "cookies": [
                    {"name": "privy-session", "value": "secret", "domain": ".myshell.ai"},
                    {"name": "privy-token", "value": "secret", "domain": ".myshell.ai"},
                ],
            },
            "",
        )

        self.assertEqual(summary["cookieNames"], ["privy-session", "privy-token"])
        self.assertEqual(summary["missingCookieNames"], ["ms_token"])
        self.assertNotIn("secret", str(summary))


if __name__ == "__main__":
    unittest.main()
