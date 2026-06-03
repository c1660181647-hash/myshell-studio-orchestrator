import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("probe_myshell_art_api.py")
spec = importlib.util.spec_from_file_location("probe_myshell_art_api", MODULE_PATH)
probe = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(probe)


class ProbeMyShellArtApiTest(unittest.TestCase):
    def test_build_headers_uses_ms_token_without_exposing_it_in_summary(self) -> None:
        cookies = [
            {"name": "ms_token", "value": "secret-token", "domain": ".myshell.ai"},
            {"name": "VISITOR_ID", "value": "visitor-1", "domain": ".myshell.ai"},
        ]

        headers = probe.build_headers(cookies, now_ms=1_780_000_000_000)
        summary = probe.safe_probe_summary(
            {
                "success": True,
                "data": {"userId": "user-1", "nickname": "Alice", "token": "secret-token"},
            }
        )

        self.assertEqual(headers["Authorization"], "Bearer secret-token")
        self.assertIn("ms_token=secret-token", headers["Cookie"])
        self.assertNotIn("secret-token", str(summary))
        self.assertEqual(summary["dataKeys"], ["nickname", "token", "userId"])

    def test_generate_body_omits_empty_article_id(self) -> None:
        body = probe.generate_body("1751532766", [], "")

        self.assertEqual(body, {"botId": "1751532766", "inputImg": []})

    def test_cookie_header_skips_values_that_cannot_be_sent_as_http_headers(self) -> None:
        header = probe.cookie_header(
            [
                {"name": "ms_token", "value": "secret-token"},
                {"name": "localized", "value": "中文"},
            ]
        )

        self.assertIn("ms_token=secret-token", header)
        self.assertNotIn("localized", header)

    def test_build_headers_skips_authorization_when_ms_token_is_not_header_safe(self) -> None:
        headers = probe.build_headers([{"name": "ms_token", "value": "bad\ufffdtoken"}])

        self.assertNotIn("Authorization", headers)


if __name__ == "__main__":
    unittest.main()
