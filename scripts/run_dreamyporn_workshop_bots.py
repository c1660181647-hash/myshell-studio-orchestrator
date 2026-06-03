#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = REPO_ROOT / "orchestrator" / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from studio import (  # noqa: E402
    DREAMYPORN_WEB_GENERATE_PREFIX,
    _dreamy_floor_defaults,
    _dreamyporn_default_input_image_file,
    _dreamyporn_upload_image,
    _dreamyporn_web_request,
    _dreamyporn_web_task_media,
    _guess_image_content_type,
    _slug_from_dreamy_goto_link,
)


DEFAULT_OUTPUT = REPO_ROOT / ".studio-delivery-check" / "dreamyporn-workshop-results.json"
DEFAULT_DETAIL_BASE_URL = "https://dreamyporn.ai"
NEXT_FLIGHT_RE = re.compile(r"self\.__next_f\.push\((.*?)\)</script>", re.S)
VIDEO_SUFFIXES = (".mp4", ".mov", ".webm", ".m4v")
NON_TERMINAL_STATUSES = {"pending", "running", "processing", "queued", ""}


class DreamyWorkshopError(RuntimeError):
    pass


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _safe_error(exc: Exception) -> str:
    detail = str(exc)
    return f"{type(exc).__name__}: {detail}" if detail else type(exc).__name__


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    return payload if isinstance(payload, dict) else {}


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _next_flight_text(html: str) -> str:
    parts: list[str] = []
    for match in NEXT_FLIGHT_RE.finditer(html):
        try:
            value = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue
        if isinstance(value, list) and len(value) > 1 and isinstance(value[1], str):
            parts.append(value[1])
    return "".join(parts)


def _extract_balanced_object(text: str, start: int) -> str:
    if start < 0 or start >= len(text) or text[start] != "{":
        raise DreamyWorkshopError("detail payload did not contain an object at the expected position")
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    raise DreamyWorkshopError("detail payload info object was not balanced")


def extract_detail_info(html: str) -> dict[str, Any]:
    text = _next_flight_text(html)
    marker = '"info":'
    index = text.find(marker)
    if index < 0:
        raise DreamyWorkshopError("Dreamy detail page did not include an info payload")
    info = json.loads(_extract_balanced_object(text, index + len(marker)))
    single_text = info.get("singleText")
    if isinstance(single_text, str) and single_text.strip():
        try:
            info["singleTextJson"] = json.loads(single_text)
        except json.JSONDecodeError:
            info["singleTextJson"] = {}
    else:
        info["singleTextJson"] = {}
    return info


def fetch_detail_info(floor_url: str, slug: str, *, base_url: str = DEFAULT_DETAIL_BASE_URL, timeout: float = 30.0) -> dict[str, Any]:
    url = f"{base_url.rstrip('/')}/{quote(floor_url.strip('/'), safe='')}/{quote(slug, safe='')}"
    request = Request(
        url,
        headers={
            "Accept": "text/html,application/xhtml+xml",
            "User-Agent": "Mozilla/5.0 (compatible; dreamy-workshop-runner/1.0)",
        },
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            html = response.read().decode("utf-8", errors="replace")
    except (HTTPError, URLError, TimeoutError) as exc:
        raise DreamyWorkshopError(f"failed to fetch Dreamy detail page {floor_url}/{slug}: {exc}") from exc
    return extract_detail_info(html)


def _option_value(option: Any) -> str:
    if isinstance(option, dict):
        for key in ("value", "label", "title", "name", "text"):
            value = option.get(key)
            if value not in (None, ""):
                return str(value)
        return ""
    return str(option) if option not in (None, "") else ""


def _form_values(form: list[dict[str, Any]], *, source_image_url: str, prompt: str) -> list[str]:
    values: list[str] = []
    for field in sorted((item for item in form if isinstance(item, dict)), key=lambda item: int(item.get("index") or 0)):
        component = str(field.get("component") or "")
        default = field.get("default")
        options = field.get("options") if isinstance(field.get("options"), list) else []
        if component == "Uploader":
            values.append(json.dumps([source_image_url], ensure_ascii=False) if field.get("multi") else source_image_url)
            continue
        if component in {"RadioGroup", "ImageChoices", "Select", "SegmentedControl"}:
            values.append(str(default or _option_value(options[0] if options else "") or ""))
            continue
        if component in {"Textarea", "TextArea", "Input", "TextInput", "PromptInput"}:
            values.append(str(default or prompt))
            continue
        if default not in (None, ""):
            values.append(str(default))
        elif options:
            values.append(_option_value(options[0]))
        elif field.get("required", True):
            values.append(prompt)
        else:
            values.append("")
    return values


def _is_video_info(info: dict[str, Any]) -> bool:
    for key in ("templateImage", "templateImageh5", "exploreImage", "shareImage"):
        value = str(info.get(key) or "").lower()
        if any(suffix in value for suffix in VIDEO_SUFFIXES):
            return True
    return False


async def discover_catalog(*, page_size: int = 100) -> list[dict[str, Any]]:
    bots: list[dict[str, Any]] = []
    seen: set[str] = set()
    for floor in _dreamy_floor_defaults():
        floor_url = str(floor.get("floorUrl") or "")
        page = 1
        while floor_url:
            payload = await _dreamyporn_web_request(
                f"{DREAMYPORN_WEB_GENERATE_PREFIX}/explore",
                {"floorUrl": floor_url, "page": page, "pageSize": page_size},
            )
            response_floors = payload.get("floors") if isinstance(payload.get("floors"), list) else []
            for response_floor in response_floors:
                if not isinstance(response_floor, dict):
                    continue
                images = response_floor.get("images") if isinstance(response_floor.get("images"), list) else []
                active_floor = str(response_floor.get("floorUrl") or floor_url)
                for image in images:
                    if not isinstance(image, dict):
                        continue
                    slug = _slug_from_dreamy_goto_link(str(image.get("gotoLink") or image.get("goto_link") or ""))
                    if not slug or slug in seen:
                        continue
                    seen.add(slug)
                    template_url = str(image.get("templatePosterUrl") or image.get("templateUrl") or "")
                    image_url = str(image.get("imagePosterUrl") or image.get("imageUrl") or template_url)
                    bots.append(
                        {
                            "slug": slug,
                            "floorUrl": active_floor,
                            "name": str(image.get("title") or slug),
                            "catalogImageUrl": image_url,
                            "templateUrl": template_url,
                        }
                    )
            if not payload.get("hasMore"):
                break
            page += 1
    return bots


def _report_bots(report: dict[str, Any]) -> dict[str, dict[str, Any]]:
    bots = report.setdefault("bots", {})
    return bots if isinstance(bots, dict) else {}


def _merge_catalog(report: dict[str, Any], catalog: list[dict[str, Any]]) -> None:
    bots = _report_bots(report)
    for item in catalog:
        slug = str(item.get("slug") or "")
        if not slug:
            continue
        existing = bots.get(slug) if isinstance(bots.get(slug), dict) else {}
        bots[slug] = {**item, **existing, "slug": slug}


def _apply_detail(record: dict[str, Any], detail: dict[str, Any]) -> None:
    single = detail.get("singleTextJson") if isinstance(detail.get("singleTextJson"), dict) else {}
    form = single.get("form") if isinstance(single.get("form"), list) else []
    record.update(
        {
            "name": str(detail.get("botName") or record.get("name") or record.get("slug") or ""),
            "botId": str(detail.get("botId") or record.get("botId") or ""),
            "articleId": str(detail.get("slugId") or record.get("articleId") or record.get("slug") or ""),
            "template": str(detail.get("template") or record.get("template") or ""),
            "type": "image-to-video" if _is_video_info(detail) else "text-to-image",
            "form": form,
            "formComponents": [str(field.get("component") or "") for field in form if isinstance(field, dict)],
            "detailResolvedAt": _now_iso(),
        }
    )


async def _upload_source_image(source_image: Path | None) -> str:
    image_path = source_image or _dreamyporn_default_input_image_file()
    if not image_path or not image_path.exists():
        raise DreamyWorkshopError("No source image available for Dreamy workshop generation.")
    return await _dreamyporn_upload_image(
        image_path.read_bytes(),
        filename=image_path.name,
        content_type=_guess_image_content_type(image_path.name),
    )


async def _poll_task(record: dict[str, Any]) -> None:
    task_id = str(record.get("taskId") or "")
    if not task_id:
        return
    payload = await _dreamyporn_web_request(f"{DREAMYPORN_WEB_GENERATE_PREFIX}/generate_result", {"outputJobId": task_id})
    media = _dreamyporn_web_task_media(payload, task_id)
    raw_status = str(media.get("status") or record.get("status") or "running").lower()
    record["status"] = "done" if raw_status in {"done", "completed", "success"} and media.get("mediaUrl") else raw_status
    record["rawTaskStatus"] = raw_status
    record["queuePosition"] = media.get("queuePosition", "")
    record["checkedAt"] = _now_iso()
    if media.get("mediaUrl"):
        record["mediaUrl"] = media["mediaUrl"]
        record["remoteUrl"] = media["mediaUrl"]
        record["targetBotExecuted"] = True
    if media.get("posterUrl"):
        record["posterUrl"] = media["posterUrl"]


async def _submit_task(record: dict[str, Any], *, source_image_url: str, prompt: str) -> None:
    bot_id = str(record.get("botId") or "")
    article_id = str(record.get("articleId") or record.get("slug") or "")
    if not bot_id or not article_id:
        raise DreamyWorkshopError(f"{record.get('slug')} is missing botId/articleId")
    form = record.get("form") if isinstance(record.get("form"), list) else []
    input_values = _form_values(form, source_image_url=source_image_url, prompt=prompt)
    if not input_values:
        input_values = [source_image_url]
    response = await _dreamyporn_web_request(
        f"{DREAMYPORN_WEB_GENERATE_PREFIX}/generate",
        {
            "botId": bot_id,
            "inputImg": input_values,
            "articleId": article_id,
            "enableRecommendations": False,
        },
    )
    task_id = str(response.get("outputJobId") or response.get("output_job_id") or "")
    if not task_id:
        raise DreamyWorkshopError(f"{record.get('slug')} generate response did not include outputJobId")
    record.update(
        {
            "status": "submitted",
            "taskId": task_id,
            "submittedAt": _now_iso(),
            "inputValueCount": len(input_values),
            "targetBotExecuted": False,
        }
    )


def _summary(report: dict[str, Any]) -> dict[str, int]:
    bots = [item for item in _report_bots(report).values() if isinstance(item, dict)]
    return {
        "catalog": len(bots),
        "resolved": sum(1 for item in bots if item.get("botId") and item.get("articleId")),
        "submitted": sum(1 for item in bots if item.get("taskId")),
        "done": sum(1 for item in bots if item.get("status") == "done" and item.get("mediaUrl")),
        "running": sum(1 for item in bots if str(item.get("status") or "") in {"submitted", "pending", "running", "processing", "queued"}),
        "errors": sum(1 for item in bots if str(item.get("status") or "").startswith("error")),
        "unavailable": sum(1 for item in bots if str(item.get("status") or "").startswith("unavailable")),
        "queueFull": sum(1 for item in bots if item.get("status") == "queue_full"),
    }


def _target_slugs(report: dict[str, Any], explicit_slugs: list[str], limit: int | None) -> list[str]:
    slugs = explicit_slugs or sorted(_report_bots(report))
    if limit is not None:
        return slugs[: max(0, limit)]
    return slugs


def _seed_tasks(report: dict[str, Any], seed_tasks: list[str]) -> None:
    bots = _report_bots(report)
    for item in seed_tasks:
        if "=" not in item:
            raise DreamyWorkshopError("--seed-task must use slug=taskId")
        slug, task_id = item.split("=", 1)
        slug = slug.strip()
        task_id = task_id.strip()
        if not slug or not task_id:
            raise DreamyWorkshopError("--seed-task must use non-empty slug=taskId")
        record = bots.setdefault(slug, {"slug": slug})
        record.setdefault("articleId", slug)
        record["taskId"] = task_id
        record.setdefault("status", "submitted")
        record.setdefault("seededAt", _now_iso())


async def run(args: argparse.Namespace) -> dict[str, Any]:
    report = _read_json(args.output)
    report.setdefault("version", "dreamyporn-workshop-v1")
    report.setdefault("createdAt", _now_iso())
    report["checkedAt"] = _now_iso()
    report["source"] = "dreamyporn-web"

    if not args.no_discover:
        _merge_catalog(report, await discover_catalog(page_size=args.page_size))
    _seed_tasks(report, args.seed_task or [])
    target_slugs = _target_slugs(report, args.slug or [], args.limit)

    for slug in target_slugs:
        record = _report_bots(report).get(slug)
        if not isinstance(record, dict):
            continue
        if record.get("status") == "unavailable_detail":
            continue
        if not record.get("botId") or not record.get("form"):
            try:
                detail = fetch_detail_info(str(record.get("floorUrl") or ""), slug, base_url=args.detail_base_url, timeout=args.detail_timeout)
                _apply_detail(record, detail)
            except Exception as exc:
                message = _safe_error(exc)
                record["status"] = "unavailable_detail" if "HTTP Error 410" in message or "HTTP Error 404" in message else "error_detail"
                record["message"] = message
                record["checkedAt"] = _now_iso()

    for slug in target_slugs:
        record = _report_bots(report).get(slug)
        if isinstance(record, dict) and record.get("taskId") and str(record.get("status") or "") != "done":
            try:
                await _poll_task(record)
            except Exception as exc:
                record["status"] = "error_poll"
                record["message"] = _safe_error(exc)
                record["checkedAt"] = _now_iso()

    new_submissions = 0
    has_active = any(
        isinstance(record, dict) and str(record.get("status") or "") in NON_TERMINAL_STATUSES and record.get("taskId")
        for record in _report_bots(report).values()
    )
    source_image_url = ""
    for slug in target_slugs:
        if args.max_new_submissions <= new_submissions:
            break
        record = _report_bots(report).get(slug)
        if not isinstance(record, dict) or record.get("mediaUrl") or record.get("taskId"):
            continue
        if args.one_active and has_active:
            record.setdefault("status", "waiting_for_active_task")
            continue
        if not record.get("botId"):
            continue
        if not source_image_url:
            source_image_url = await _upload_source_image(args.source_image)
        try:
            await _submit_task(record, source_image_url=source_image_url, prompt=args.prompt)
            new_submissions += 1
            has_active = True
            await _poll_task(record)
        except Exception as exc:
            message = _safe_error(exc)
            record["status"] = "queue_full" if "ERROR_REASON_TOO_MANY_REQUESTS" in message or "429" in message else "error_submit"
            record["message"] = message
            record["checkedAt"] = _now_iso()
            if record["status"] == "queue_full" and args.stop_on_queue_full:
                break
        if args.submit_delay and new_submissions < args.max_new_submissions:
            time.sleep(args.submit_delay)

    report["summary"] = _summary(report)
    report["results"] = [
        {
            "slug": slug,
            "name": record.get("name"),
            "status": record.get("status"),
            "taskId": record.get("taskId", ""),
            "queuePosition": record.get("queuePosition", ""),
            "mediaUrl": record.get("mediaUrl", ""),
            "posterUrl": record.get("posterUrl", ""),
            "botId": record.get("botId", ""),
            "articleId": record.get("articleId", ""),
        }
        for slug, record in sorted(_report_bots(report).items())
        if isinstance(record, dict)
    ]
    _write_json(args.output, report)
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run real DreamyPorn workshop bots and persist generated media results.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--slug", action="append", default=[], help="Specific Dreamy slug to process. Repeatable.")
    parser.add_argument("--limit", type=int, help="Limit processed slugs after discovery.")
    parser.add_argument("--max-new-submissions", type=int, default=1)
    parser.add_argument("--one-active", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--stop-on-queue-full", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--seed-task", action="append", default=[], help="Record and poll an existing task as slug=taskId.")
    parser.add_argument("--source-image", type=Path)
    parser.add_argument("--prompt", default="Dreamy Studio workshop verification run.")
    parser.add_argument("--submit-delay", type=float, default=0.0)
    parser.add_argument("--page-size", type=int, default=100)
    parser.add_argument("--detail-base-url", default=DEFAULT_DETAIL_BASE_URL)
    parser.add_argument("--detail-timeout", type=float, default=30.0)
    parser.add_argument("--no-discover", action="store_true")
    args = parser.parse_args(argv)
    try:
        report = asyncio.run(run(args))
    except DreamyWorkshopError as exc:
        print(json.dumps({"status": "error", "message": str(exc)}, indent=2, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps({"status": "ok", "output": str(args.output), "summary": report["summary"]}, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
