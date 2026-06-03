#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import base64
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Awaitable, Callable


REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "orchestrator" / "backend"
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from bot_catalog import MYSHELL_BOTS, get_bot_by_slug  # noqa: E402
from bot_previews import DREAMY_BOTS  # noqa: E402
from materialize_bot_preview_manifest import prompt_for_bot  # noqa: E402


DEFAULT_OUTPUT = REPO_ROOT / ".studio-delivery-check" / "target-bot-preview-urls.json"
DEFAULT_SOURCE_IMAGE = REPO_ROOT / "frontend" / "public" / "generated" / "bot-previews" / "ai-porn-generator.jpg"

Runner = Callable[..., Awaitable[dict[str, Any]]]


class TargetBotPreviewError(RuntimeError):
    pass


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _all_bots(include_dreamy: bool = False) -> list[dict[str, Any]]:
    dreamy = [{**bot, "pageId": "dreamy-miniapp"} for bot in DREAMY_BOTS] if include_dreamy else []
    art = [{**bot, "pageId": "myshell-art"} for bot in MYSHELL_BOTS]
    return [*dreamy, *art]


def _selected_bots(slugs: list[str] | None, include_dreamy: bool) -> list[dict[str, Any]]:
    bots = _all_bots(include_dreamy=include_dreamy)
    if not slugs:
        return bots
    by_slug = {str(bot["slug"]): bot for bot in bots}
    missing = [slug for slug in slugs if slug not in by_slug]
    if missing:
        raise TargetBotPreviewError(f"Unknown bot slug(s): {', '.join(missing)}")
    return [by_slug[slug] for slug in slugs]


def _source_image_for(bot: dict[str, Any], explicit_source: Path | None) -> Path | None:
    if str(bot.get("type") or "") == "text-to-image":
        return None
    if explicit_source:
        return explicit_source
    candidate = REPO_ROOT / "frontend" / "public" / "generated" / "bot-previews" / f"{bot['slug']}.jpg"
    if candidate.exists():
        return candidate
    return DEFAULT_SOURCE_IMAGE


def build_run_plan(
    *,
    slugs: list[str] | None = None,
    include_dreamy: bool = False,
    source_image: Path | None = None,
) -> list[dict[str, Any]]:
    plan: list[dict[str, Any]] = []
    for bot in _selected_bots(slugs, include_dreamy=include_dreamy):
        requires_image = str(bot.get("type") or "") in {"image-to-image", "image-to-video"}
        source = _source_image_for(bot, source_image) if requires_image else None
        plan.append(
            {
                "botSlug": bot["slug"],
                "botName": bot.get("name"),
                "botType": bot.get("type"),
                "pageId": bot.get("pageId") or "myshell-art",
                "executor": "myshell-art-cdp" if bot.get("pageId") != "dreamy-miniapp" else "dreamy-server",
                "prompt": prompt_for_bot(bot),
                "genButton": bot.get("gen_button", ""),
                "requiresImage": requires_image,
                "sourceImage": str(source) if source else "",
            }
        )
    return plan


def _image_data(path: str) -> str:
    if not path:
        return ""
    source = Path(path).expanduser()
    if not source.exists():
        raise TargetBotPreviewError(f"Source image does not exist: {source}")
    return base64.b64encode(source.read_bytes()).decode("ascii")


def _default_runner() -> Runner:
    from myshell_bridge import generate_via_bot

    return generate_via_bot


def _entry_from_result(plan_item: dict[str, Any], result: dict[str, Any], checked_at: str) -> dict[str, Any] | None:
    output_url = str(result.get("output_url") or result.get("mediaUrl") or result.get("remoteUrl") or "")
    if str(result.get("status") or "") != "done" or not output_url:
        return None
    return {
        "remoteUrl": output_url,
        "source": "myshell-target-bot-cdp",
        "sourceWidgetId": "",
        "sourceWidgetName": "",
        "prompt": plan_item["prompt"],
        "checkedAt": checked_at,
        "targetBotExecuted": True,
        "execution": {
            "status": "done",
            "executor": plan_item["executor"],
            "targetPageUrl": f"https://art.myshell.ai/creative/{plan_item['botSlug']}",
            "botSlug": plan_item["botSlug"],
            "botName": plan_item.get("botName"),
            "taskId": result.get("task_id") or result.get("taskId") or "",
            "checkedAt": checked_at,
        },
    }


async def run_preview_batch(
    *,
    slugs: list[str] | None = None,
    include_dreamy: bool = False,
    source_image: Path | None = None,
    runner: Runner | None = None,
    continue_on_error: bool = True,
) -> dict[str, Any]:
    checked_at = _now_iso()
    active_runner = runner or _default_runner()
    plan = build_run_plan(slugs=slugs, include_dreamy=include_dreamy, source_image=source_image)
    previews: dict[str, dict[str, Any]] = {}
    results: list[dict[str, Any]] = []

    for item in plan:
        slug = item["botSlug"]
        if item["pageId"] == "dreamy-miniapp":
            result = {
                "botSlug": slug,
                "status": "skipped",
                "message": "Dreamy target execution requires DREAMY_TELEGRAM_INIT_DATA and is handled by /api/studio/generation-smoke.",
            }
            results.append(result)
            if not continue_on_error:
                raise TargetBotPreviewError(result["message"])
            continue
        try:
            result = await active_runner(
                bot_slug=slug,
                prompt=item["prompt"],
                gen_button=item["genButton"],
                image_data=_image_data(item["sourceImage"]),
            )
        except Exception as exc:
            result = {"status": "error", "message": str(exc)}
            if not continue_on_error:
                raise
        result = {"botSlug": slug, **result}
        results.append(result)
        entry = _entry_from_result(item, result, checked_at)
        if entry:
            previews[slug] = entry

    failed = sum(1 for item in results if item.get("status") != "done")
    return {
        "version": f"{checked_at[:10]}-target-bot-preview-runs",
        "checkedAt": checked_at,
        "summary": {
            "planned": len(plan),
            "executed": len(previews),
            "failed": failed,
            "dreamySkipped": sum(1 for item in results if item.get("status") == "skipped"),
        },
        "previews": previews,
        "results": results,
    }


def _load_existing(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    if isinstance(payload, dict) and isinstance(payload.get("previews"), dict):
        return dict(payload["previews"])
    if isinstance(payload, dict):
        return dict(payload)
    return {}


async def async_main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run real target MyShell Art bots and write manifest input JSON.")
    parser.add_argument("--slug", action="append", default=[], help="Bot slug to run. Repeatable. Defaults to all Art bots.")
    parser.add_argument("--include-dreamy", action="store_true", help="Include Dreamy bots in the plan; they are skipped unless run through generation-smoke.")
    parser.add_argument("--source-image", type=Path, help="Source image for image-to-image and image-to-video bots.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--plan-only", action="store_true", help="Print the execution plan without running bots.")
    parser.add_argument("--continue-on-error", action="store_true", default=True)
    parser.add_argument("--merge-existing", action="store_true", help="Merge successful runs into an existing output file.")
    args = parser.parse_args(argv)

    try:
        slugs = args.slug or None
        if args.plan_only:
            print(json.dumps({"items": build_run_plan(slugs=slugs, include_dreamy=args.include_dreamy, source_image=args.source_image)}, indent=2, ensure_ascii=False))
            return 0
        report = await run_preview_batch(
            slugs=slugs,
            include_dreamy=args.include_dreamy,
            source_image=args.source_image,
            continue_on_error=args.continue_on_error,
        )
        if args.merge_existing:
            merged = _load_existing(args.output)
            merged.update(report["previews"])
            report["previews"] = merged
            report["summary"]["executed"] = len(merged)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(json.dumps({"status": "ok", "output": str(args.output), "summary": report["summary"]}, indent=2, ensure_ascii=False))
        return 0 if report["summary"]["failed"] == 0 else 1
    except TargetBotPreviewError as exc:
        print(json.dumps({"status": "error", "message": str(exc)}, indent=2, ensure_ascii=False), file=sys.stderr)
        return 1


def main(argv: list[str] | None = None) -> int:
    return asyncio.run(async_main(argv))


if __name__ == "__main__":
    raise SystemExit(main())
