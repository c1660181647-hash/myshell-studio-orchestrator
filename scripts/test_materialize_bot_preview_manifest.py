import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("materialize_bot_preview_manifest.py")
spec = importlib.util.spec_from_file_location("materialize_bot_preview_manifest", MODULE_PATH)
materialize = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(materialize)


class MaterializeBotPreviewManifestTest(unittest.TestCase):
    def test_build_manifest_marks_entries_bot_specific(self) -> None:
        manifest = materialize.build_manifest(
            {
                "ai-porn-generator": {"remoteUrl": "https://cdn.example/dreamy.jpg", "prompt": "dreamy prompt"},
                "brat-generator": {"remoteUrl": "https://cdn.example/brat.jpg", "targetBotExecuted": True},
            },
            dry_run=True,
        )

        self.assertEqual(manifest["summary"]["botSpecificAssets"], 2)
        self.assertEqual(manifest["botPreviews"]["ai-porn-generator"]["assetId"], "ai-porn-generator")
        self.assertTrue(manifest["botPreviews"]["brat-generator"]["targetBotExecuted"])
        assets_by_slug = {asset["botSlug"]: asset for asset in manifest["assets"]}
        self.assertTrue(assets_by_slug["ai-porn-generator"]["botSpecific"])
        self.assertEqual(assets_by_slug["brat-generator"]["sourceWidgetId"], materialize.DEFAULT_WIDGET_ID)

    def test_build_manifest_rejects_unknown_slug(self) -> None:
        with self.assertRaises(materialize.PreviewManifestError):
            materialize.build_manifest({"not-a-bot": {"remoteUrl": "https://cdn.example/x.jpg"}}, dry_run=True)

    def test_build_manifest_can_merge_single_target_run_into_existing_manifest(self) -> None:
        existing_manifest = materialize.build_manifest(
            {
                "ai-porn-generator": {"remoteUrl": "https://cdn.example/dreamy.jpg", "prompt": "dreamy prompt"},
                "brat-generator": {"remoteUrl": "https://cdn.example/old-brat.jpg", "targetBotExecuted": False},
            },
            dry_run=True,
        )

        manifest = materialize.build_manifest(
            {
                "brat-generator": {
                    "remoteUrl": "https://cdn.example/new-brat.jpg",
                    "targetBotExecuted": True,
                    "source": "myshell-target-bot-api",
                }
            },
            dry_run=True,
            merge_existing=True,
            existing_manifest=existing_manifest,
        )

        assets_by_slug = {asset["botSlug"]: asset for asset in manifest["assets"]}
        self.assertIn("ai-porn-generator", assets_by_slug)
        self.assertEqual(assets_by_slug["ai-porn-generator"]["originalRemoteUrl"], "https://cdn.example/dreamy.jpg")
        self.assertEqual(assets_by_slug["brat-generator"]["originalRemoteUrl"], "https://cdn.example/new-brat.jpg")
        self.assertEqual(assets_by_slug["brat-generator"]["source"], "myshell-target-bot-api")
        self.assertFalse(manifest["botPreviews"]["ai-porn-generator"]["targetBotExecuted"])
        self.assertTrue(manifest["botPreviews"]["brat-generator"]["targetBotExecuted"])
        self.assertEqual(manifest["summary"]["botSpecificAssets"], 2)

    def test_prompt_worklist_covers_dreamy_and_art_bots(self) -> None:
        bots = materialize._all_bots()
        self.assertGreaterEqual(len(bots), 40)
        slugs = {bot["slug"] for bot in bots}
        self.assertIn("ai-porn-generator", slugs)
        self.assertIn("brat-generator", slugs)
        self.assertIn("sora-video-generator", slugs)
        self.assertIn("MyShell Studio", materialize.prompt_for_bot(bots[0]))


if __name__ == "__main__":
    unittest.main()
