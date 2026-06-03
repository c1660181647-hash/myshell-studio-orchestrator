import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("run_target_bot_previews.py")
spec = importlib.util.spec_from_file_location("run_target_bot_previews", MODULE_PATH)
run_target = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(run_target)


class RunTargetBotPreviewsTest(unittest.IsolatedAsyncioTestCase):
    async def test_run_selected_art_bot_marks_target_execution(self) -> None:
        calls = []

        async def fake_runner(**kwargs):
            calls.append(kwargs)
            return {"status": "done", "output_url": "https://cdn.example/brat.png", "task_id": "task-1"}

        report = await run_target.run_preview_batch(
            slugs=["brat-generator"],
            runner=fake_runner,
            include_dreamy=False,
        )

        self.assertEqual(report["summary"]["executed"], 1)
        self.assertEqual(report["summary"]["failed"], 0)
        self.assertEqual(calls[0]["bot_slug"], "brat-generator")
        self.assertEqual(calls[0]["gen_button"], "Generate Brat Cover")
        entry = report["previews"]["brat-generator"]
        self.assertEqual(entry["remoteUrl"], "https://cdn.example/brat.png")
        self.assertEqual(entry["source"], "myshell-target-bot-cdp")
        self.assertTrue(entry["targetBotExecuted"])
        self.assertEqual(entry["execution"]["status"], "done")

    async def test_failed_target_run_does_not_mark_executed(self) -> None:
        async def fake_runner(**_kwargs):
            return {"status": "error", "message": "Generate button not found"}

        report = await run_target.run_preview_batch(
            slugs=["brat-generator"],
            runner=fake_runner,
            include_dreamy=False,
        )

        self.assertEqual(report["summary"]["executed"], 0)
        self.assertEqual(report["summary"]["failed"], 1)
        self.assertNotIn("brat-generator", report["previews"])
        self.assertEqual(report["results"][0]["status"], "error")

    def test_plan_requires_source_image_for_image_input_bots(self) -> None:
        plan = run_target.build_run_plan(slugs=["seedream-multi-chart"], include_dreamy=False)

        self.assertEqual(len(plan), 1)
        self.assertEqual(plan[0]["botSlug"], "seedream-multi-chart")
        self.assertTrue(plan[0]["requiresImage"])
        self.assertIn("sourceImage", plan[0])

    def test_default_plan_targets_art_bots_only(self) -> None:
        plan = run_target.build_run_plan()
        slugs = {item["botSlug"] for item in plan}

        self.assertIn("brat-generator", slugs)
        self.assertNotIn("ai-porn-generator", slugs)


if __name__ == "__main__":
    unittest.main()
