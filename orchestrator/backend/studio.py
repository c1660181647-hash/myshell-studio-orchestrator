from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import uuid
import base64
import asyncio
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Optional
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit
from urllib.request import urlretrieve

import httpx
from fastapi import Body, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse

from bot_catalog import MYSHELL_BOTS, get_bot_by_slug
from bot_previews import DREAMY_BOTS, get_dreamy_bot_by_slug, list_bot_previews
import myshell_art_api
from studio_registry import get_page, list_studio_agents, list_studio_pages, page_for_dispatch
from studio_runtime import (
    adapter_auth_status,
    cookie_source_payload,
    cookie_source_status,
    dreamy_api_base_url,
    dreamy_init_data,
    dreamyporn_web_api_base_url,
    dreamyporn_web_cookie_status,
    runtime_health,
)
from studio_store import STUDIO_STORE

try:
    from orchestrator import understand_intent
except Exception:  # pragma: no cover - keeps tests independent of optional AI deps
    understand_intent = None


StudioProject = dict[str, Any]
StudioSegment = dict[str, Any]
StudioEvent = dict[str, Any]

PROJECTS: dict[str, StudioProject] = {}
VERIFIED_DREAMY_WORKSHOP_PROJECT_ID = "dreamy_verified_workshop_two_bot"
VERIFIED_DREAMY_WORKSHOP_SEGMENTS: list[dict[str, Any]] = [
    {
        "id": "verified_workshop_segment_1",
        "type": "video",
        "url": "https://d2rzqgs9j5kr8g.cloudfront.net/video/chat/embed_obj/202606030911/551da3b2c0274fab8e1cd12c554186d4.mp4",
        "posterUrl": "https://www.myshellstatic.com/video/chat/embed_obj/202606030911/551da3b2c0274fab8e1cd12c554186d4-poster.jpg",
        "prompt": "Verified Dreamy workshop result from 3D Anime Porn.",
        "botSlug": "3d-anime-porn",
        "botId": "1769085605",
        "articleId": "3d-anime-porn",
        "botName": "3D Anime Porn",
        "action": "generate",
        "status": "done",
        "taskId": "bdcc5855a80f479dafe39c3afd3ab6fa",
        "evidence": {
            "status": "done",
            "source": "dreamyporn-workshop-web",
            "accepted": True,
            "mediaUrl": "https://d2rzqgs9j5kr8g.cloudfront.net/video/chat/embed_obj/202606030911/551da3b2c0274fab8e1cd12c554186d4.mp4",
            "taskId": "bdcc5855a80f479dafe39c3afd3ab6fa",
            "message": "Real Dreamy workshop bot completed and returned playable media.",
            "checkedAt": "2026-06-03T09:11:00Z",
        },
        "createdAt": "2026-06-03T09:11:00Z",
        "updatedAt": "2026-06-03T09:11:00Z",
    },
    {
        "id": "verified_workshop_segment_2",
        "type": "video",
        "url": "https://d2rzqgs9j5kr8g.cloudfront.net/video/chat/embed_obj/202606030923/ed0e2719080742b5a5db07483f439a84.mp4",
        "posterUrl": "https://www.myshellstatic.com/video/chat/embed_obj/202606030923/ed0e2719080742b5a5db07483f439a84-poster.jpg",
        "prompt": "Verified Dreamy workshop result from 3D Futa Porn, staged as the next segment.",
        "botSlug": "3d-futa-porn",
        "botId": "1768994068",
        "articleId": "3d-futa-porn",
        "botName": "3D Futa Porn",
        "action": "extend",
        "parentSegmentId": "verified_workshop_segment_1",
        "status": "done",
        "taskId": "ed8d4bd4aab74245aadb8f8a832c3f4b",
        "evidence": {
            "status": "done",
            "source": "dreamyporn-workshop-web",
            "accepted": True,
            "mediaUrl": "https://d2rzqgs9j5kr8g.cloudfront.net/video/chat/embed_obj/202606030923/ed0e2719080742b5a5db07483f439a84.mp4",
            "taskId": "ed8d4bd4aab74245aadb8f8a832c3f4b",
            "message": "Second real Dreamy workshop bot completed and is staged as a timeline extension.",
            "checkedAt": "2026-06-03T09:23:00Z",
        },
        "createdAt": "2026-06-03T09:23:00Z",
        "updatedAt": "2026-06-03T09:23:00Z",
    },
]

VALID_MODES = {"player", "canvas"}
VALID_ACTIONS = {"generate", "extend", "restyle", "retry-agent"}
VALID_STATUSES = {"draft", "queued", "running", "done", "timeout", "auth_missing", "error", "cancelled"}
VALID_DISPATCH_TARGET_STATUSES = {"pending", "visited", "completed", "skipped", "error", "cancelled"}
READY_AUTH_STATUSES = {"ok", "ready", "client_delegated"}
STATUS_COUNT_KEYS = ("draft", "queued", "running", "done", "timeout", "auth_missing", "error", "cancelled")
TERMINAL_CANCEL_STATUSES = {"done", "cancelled"}
CORE_DELIVERY_PAGE_IDS = {
    "dreamy-miniapp",
    "myshell-art",
    "explore",
    "ai-picks",
    "bot-detail",
    "upload",
    "tag-generator",
    "library",
    "library-detail",
    "energy-store",
    "energy-history",
    "earn",
    "share-invite",
    "settings",
    "profile",
    "checkin",
}
CORE_DELIVERY_AGENT_IDS = {
    "intent-router",
    "asset-planner",
    "dreamy-miniapp-executor",
    "myshell-art-cdp-executor",
    "miniapp-page-navigator",
    "evidence-verifier",
    "timeline",
}
READY_GATE_STATUSES = {"ok", "ready", "client_delegated"}
BLOCKED_GATE_STATUSES = {"blocked", "error"}
PENDING_DELIVERY_STATUSES = {"draft", "queued", "running"}
ISSUE_DELIVERY_STATUSES = {"timeout", "auth_missing", "error"}
MANUAL_STUDIO_ACTIONS = {
    "restore-auth",
    "start-chrome-cdp",
    "provide-project-id",
    "inspect-requirement",
    "inspect-dispatch-matrix",
    "provide-route-params",
    "wait-or-refresh",
    "retry-or-inspect",
    "restore-readiness",
    "inspect-gap",
    "wait-for-adapter",
    "poll-result",
    "retry-or-cancel",
    "inspect-error",
    "verify-evidence",
}

PLACEHOLDER_POSTERS = {
    "generate": "/gallery/creative-whale.jpg",
    "extend": "/gallery/video-flower.jpg",
    "restyle": "/gallery/style-cyber-tokyo.jpg",
    "retry-agent": "/gallery/anime-cyber.jpg",
}

IGNORED_FRONTEND_ROUTE_PREFIXES = ("/__",)
IGNORED_FRONTEND_ROUTE_EXACT = {"/"}


def _default_frontend_app_routes_file_for_backend(backend_file: Path) -> Path:
    backend_path = backend_file.resolve()
    ancestors = list(backend_path.parents)
    candidates: list[Path] = []
    if len(ancestors) >= 3:
        candidates.append(ancestors[2] / "frontend" / "src" / "App.tsx")
    if ancestors:
        candidates.append(ancestors[0] / "frontend" / "src" / "App.tsx")
    candidates.append(Path("/app/frontend/src/App.tsx"))
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


DEFAULT_FRONTEND_APP_ROUTES_FILE = _default_frontend_app_routes_file_for_backend(Path(__file__))


def _frontend_route_source_path() -> Path:
    configured = os.environ.get("STUDIO_FRONTEND_APP_ROUTES_FILE")
    return Path(configured) if configured else DEFAULT_FRONTEND_APP_ROUTES_FILE


def _normalize_app_route(route: str) -> str:
    route = (route or "").strip()
    if not route:
        return ""
    parsed = urlsplit(route)
    return parsed.path or route


def _extract_frontend_app_routes(source: str) -> list[str]:
    routes = re.findall(r"<Route\b[^>]*\bpath=[\"']([^\"']+)[\"']", source)
    normalized_routes = [_normalize_app_route(route) for route in routes]
    return sorted({route for route in normalized_routes if route})


def _frontend_route_coverage(pages: list[dict[str, Any]]) -> dict[str, Any]:
    source_path = _frontend_route_source_path()
    if not source_path.exists():
        return {
            "status": "source_unavailable",
            "sourcePath": str(source_path),
            "message": "Frontend App route source is not available in this runtime.",
            "appRoutes": [],
            "registeredRoutes": sorted(
                {
                    _normalize_app_route(str(page.get("appRoute") or ""))
                    for page in pages
                    if _normalize_app_route(str(page.get("appRoute") or ""))
                }
            ),
            "coveredRoutes": [],
            "missingAppRoutes": [],
            "extraRegistryRoutes": [],
            "ignoredAppRoutes": [],
        }

    try:
        source = source_path.read_text(encoding="utf-8")
    except OSError as exc:
        registered_routes = sorted(
            {
                _normalize_app_route(str(page.get("appRoute") or ""))
                for page in pages
                if _normalize_app_route(str(page.get("appRoute") or ""))
            }
        )
        return {
            "status": "error",
            "sourcePath": str(source_path),
            "message": f"Frontend App route source could not be read: {exc}",
            "appRoutes": [],
            "registeredRoutes": registered_routes,
            "coveredRoutes": [],
            "missingAppRoutes": [],
            "extraRegistryRoutes": registered_routes,
            "ignoredAppRoutes": [],
        }

    app_routes = _extract_frontend_app_routes(source)
    ignored_routes = sorted(
        route
        for route in app_routes
        if route in IGNORED_FRONTEND_ROUTE_EXACT
        or any(route.startswith(prefix) for prefix in IGNORED_FRONTEND_ROUTE_PREFIXES)
    )
    routable_app_routes = sorted(route for route in app_routes if route not in set(ignored_routes))
    registered_routes = sorted(
        {
            _normalize_app_route(str(page.get("appRoute") or ""))
            for page in pages
            if _normalize_app_route(str(page.get("appRoute") or ""))
        }
    )
    app_route_set = set(routable_app_routes)
    registered_route_set = set(registered_routes)
    missing_routes = sorted(app_route_set - registered_route_set)
    extra_routes = sorted(registered_route_set - app_route_set)
    covered_routes = sorted(app_route_set & registered_route_set)
    status = "covered" if not missing_routes and not extra_routes else "mismatch"
    return {
        "status": status,
        "sourcePath": str(source_path),
        "appRoutes": routable_app_routes,
        "registeredRoutes": registered_routes,
        "coveredRoutes": covered_routes,
        "missingAppRoutes": missing_routes,
        "extraRegistryRoutes": extra_routes,
        "ignoredAppRoutes": ignored_routes,
        "message": (
            f"{len(covered_routes)} frontend routes covered"
            if status == "covered"
            else f"{len(missing_routes)} missing app routes, {len(extra_routes)} extra registry routes"
        ),
    }


def _agent_id_for_page(page: dict[str, Any]) -> str:
    if page.get("executor") == "navigation":
        return "miniapp-page-navigator"
    return "myshell-art-cdp-executor" if page["id"] == "myshell-art" else "dreamy-miniapp-executor"


def _agent_id_for_dispatch(page: dict[str, Any], preferred_agent_id: str | None = None) -> str:
    agents_by_id = {agent["id"]: agent for agent in list_studio_agents()}
    if preferred_agent_id and preferred_agent_id in agents_by_id:
        return preferred_agent_id
    return _agent_id_for_page(page)


def _accepted_source_media_url(source_segment: Optional[StudioSegment]) -> str:
    if not source_segment:
        return ""
    evidence = source_segment.get("evidence") or {}
    media_url = evidence.get("mediaUrl") or source_segment.get("url") or ""
    if evidence.get("accepted") and media_url:
        return str(media_url)
    if source_segment.get("status") == "done" and source_segment.get("url"):
        return str(source_segment["url"])
    return ""


def _navigation_path_for_page(
    page: dict[str, Any],
    route: dict[str, Any] | None = None,
    source_segment: Optional[StudioSegment] = None,
) -> str:
    path = page.get("appRoute") or ""
    if not path:
        return ""

    route_params = set(page.get("routeParams") or [])
    parsed_path = urlsplit(path)
    route_defaults = {key: str(value) for key, value in (page.get("routeDefaults") or {}).items() if value is not None}
    route_values = dict(route_defaults)
    bot_slug = (route or {}).get("bot", {}).get("slug") or ""
    if "slug_id" in route_params and bot_slug:
        route_values["slug_id"] = bot_slug
    if "img" in route_params and source_segment:
        source_url = _accepted_source_media_url(source_segment)
        if source_url:
            route_values["img"] = source_url

    path_part = parsed_path.path
    path_bound_params: set[str] = set()
    for param in route_params:
        placeholder = f":{param}"
        value = route_values.get(param)
        if placeholder in path_part and value:
            path_part = path_part.replace(placeholder, quote(value, safe=""))
            path_bound_params.add(param)

    query: dict[str, str] = {key: value for key, value in parse_qsl(parsed_path.query, keep_blank_values=True)}
    for key, value in route_defaults.items():
        if key not in path_bound_params:
            query[key] = value
    for key, value in route_values.items():
        if key in route_params and key not in path_bound_params:
            query[key] = value

    if not query:
        return urlunsplit((parsed_path.scheme, parsed_path.netloc, path_part, "", parsed_path.fragment))
    return urlunsplit((parsed_path.scheme, parsed_path.netloc, path_part, urlencode(query), parsed_path.fragment))


def _navigation_contract(
    page: dict[str, Any],
    route: dict[str, Any] | None = None,
    source_segment: Optional[StudioSegment] = None,
) -> dict[str, Any]:
    if page.get("executor") != "navigation":
        return {}
    return {
        "clientAction": "navigate",
        "navigationPath": _navigation_path_for_page(page, route, source_segment),
        "studioReturnPath": "/dreamy",
    }


def _missing_route_params(page: dict[str, Any], navigation_path: str) -> list[str]:
    route_params = page.get("routeParams") or []
    if not route_params:
        return []
    app_path = urlsplit(page.get("appRoute") or "").path
    parsed_path = urlsplit(navigation_path or "")
    query_params = {key for key, _value in parse_qsl(parsed_path.query, keep_blank_values=True)}
    missing: list[str] = []
    for param in route_params:
        placeholder = f":{param}"
        if placeholder in app_path:
            if placeholder in parsed_path.path:
                missing.append(param)
            continue
        if param not in query_params:
            missing.append(param)
    return missing


def _page_with_runtime_status(page: dict[str, Any]) -> dict[str, Any]:
    auth_status = adapter_auth_status(page["id"])
    auth_state = str(auth_status.get("status") or "unknown")
    dispatch_ready = auth_state in READY_AUTH_STATUSES
    dispatch_status = "ready" if dispatch_ready else auth_state
    executor = "server" if page["id"] == "dreamy-miniapp" and auth_state == "ready" else page.get("executor", "")
    dispatch_mode = "execute-server" if executor == "server" else page.get("dispatchMode", "")
    return {
        **page,
        "executor": executor,
        "dispatchMode": dispatch_mode,
        "authStatus": auth_status,
        "dispatchReady": dispatch_ready,
        "dispatchStatus": dispatch_status,
        "dispatchMessage": auth_status.get("message") or page.get("dispatchMode") or "",
    }


def _empty_status_counts() -> dict[str, int]:
    return {status: 0 for status in STATUS_COUNT_KEYS}


def _status_counts(jobs: list[dict[str, Any]]) -> dict[str, int]:
    counts = _empty_status_counts()
    for job in jobs:
        status = str(job.get("status") or "running")
        counts[status] = counts.get(status, 0) + 1
    return counts


def _payload_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _page_agent_ids(page: dict[str, Any], page_jobs: list[dict[str, Any]], agents: list[dict[str, Any]]) -> list[str]:
    agent_ids = {
        agent["id"]
        for agent in agents
        if agent.get("pageId") == page["id"] or (page.get("executor") == "navigation" and agent["id"] == "miniapp-page-navigator")
    }
    agent_ids.update(str(job.get("agentId")) for job in page_jobs if job.get("agentId"))
    return sorted(agent_ids)


def _studio_overview(limit: int = 50) -> dict[str, Any]:
    pages = list_studio_pages()
    agents = list_studio_agents()
    jobs = STUDIO_STORE.list_jobs(limit=500)
    latest_jobs = [_job_with_evidence(job) for job in jobs[: max(1, min(limit, 100))]]
    total_counts = _status_counts(jobs)

    page_summaries: list[dict[str, Any]] = []
    for page in pages:
        page_jobs = [job for job in jobs if job.get("pageId") == page["id"] or job.get("api") == page["id"]]
        page_summaries.append(
            {
                **_page_with_runtime_status(page),
                "agentIds": _page_agent_ids(page, page_jobs, agents),
                "jobCounts": _status_counts(page_jobs),
                "latestJob": _job_with_evidence(page_jobs[0]) if page_jobs else None,
            }
        )

    agent_summaries: list[dict[str, Any]] = []
    for agent in agents:
        agent_jobs = [job for job in jobs if job.get("agentId") == agent["id"]]
        agent_summaries.append(
            {
                **agent,
                "jobCounts": _status_counts(agent_jobs),
                "latestJob": _job_with_evidence(agent_jobs[0]) if agent_jobs else None,
            }
        )

    return {
        "checkedAt": now_iso(),
        "totals": {
            "pages": len(pages),
            "agents": len(agents),
            "jobs": len(jobs),
            **total_counts,
            "issues": total_counts.get("timeout", 0) + total_counts.get("auth_missing", 0) + total_counts.get("error", 0),
        },
        "pages": page_summaries,
        "agents": agent_summaries,
        "latestJobs": latest_jobs,
    }


def _recommended_action_for_page(page: dict[str, Any]) -> str:
    if page.get("executor") == "navigation":
        return "navigate"
    if page.get("executor") == "server":
        return "execute-server"
    return "execute-client"


def _dispatch_matrix_entry(
    page: dict[str, Any],
    route: dict[str, Any],
    source_segment: Optional[StudioSegment] = None,
) -> dict[str, Any]:
    runtime_page = _page_with_runtime_status(page)
    contract = _navigation_contract(page, route, source_segment)
    navigation_path = contract.get("navigationPath", "")
    missing_params = _missing_route_params(page, navigation_path)
    dispatch_ready = bool(runtime_page["dispatchReady"]) and not missing_params
    dispatch_status = "missing_params" if missing_params else runtime_page["dispatchStatus"]
    return {
        "pageId": page["id"],
        "pageName": page["name"],
        "kind": page.get("kind", ""),
        "executor": runtime_page.get("executor", page.get("executor", "")),
        "agentId": _agent_id_for_page(page),
        "recommendedAction": _recommended_action_for_page(runtime_page),
        "dispatchReady": dispatch_ready,
        "dispatchStatus": dispatch_status,
        "dispatchMessage": "Missing route parameters: " + ", ".join(missing_params)
        if missing_params
        else runtime_page.get("dispatchMessage", ""),
        "authStatus": runtime_page["authStatus"],
        "clientAction": contract.get("clientAction"),
        "navigationPath": navigation_path,
        "studioReturnPath": contract.get("studioReturnPath"),
        "routeParams": page.get("routeParams") or [],
        "missingRouteParams": missing_params,
        "capabilities": page.get("capabilities") or [],
        "registrySource": page.get("registrySource", ""),
    }


def _dispatch_matrix(project_id: str | None = None, source_segment_id: str | None = None) -> dict[str, Any]:
    default_bot = get_bot_by_slug("seedream-multi-chart") or MYSHELL_BOTS[0]
    project = _get_project(project_id) if project_id else None
    resolved_source_segment_id = source_segment_id or (project or {}).get("selectedSegmentId")
    source_segment = _resolve_source_segment(project, resolved_source_segment_id)
    route = {
        "bot": {
            "slug": default_bot["slug"],
            "name": default_bot["name"],
            "type": default_bot["type"],
            "rating": default_bot.get("rating", 4.5),
            "description": default_bot.get("desc", ""),
            "pageUrl": f"https://art.myshell.ai/creative/{default_bot['slug']}",
        }
    }
    entries = [_dispatch_matrix_entry(page, route, source_segment) for page in list_studio_pages()]
    summary = {
        "total": len(entries),
        "ready": sum(1 for entry in entries if entry["dispatchReady"]),
        "blocked": sum(1 for entry in entries if entry["dispatchStatus"] in {"auth_missing", "error"}),
        "missingParams": sum(1 for entry in entries if entry["missingRouteParams"]),
        "navigation": sum(1 for entry in entries if entry["executor"] == "navigation"),
        "client": sum(1 for entry in entries if entry["executor"] == "client"),
        "server": sum(1 for entry in entries if entry["executor"] == "server"),
    }
    return {
        "checkedAt": now_iso(),
        "projectId": project.get("projectId") if project else None,
        "sourceSegmentId": source_segment.get("id") if source_segment else None,
        "sourceMediaUrl": _accepted_source_media_url(source_segment),
        "summary": summary,
        "entries": entries,
    }


def _coverage_status(entry: dict[str, Any], page_jobs: list[dict[str, Any]], accepted_count: int) -> str:
    if not entry.get("dispatchReady"):
        return "blocked"
    latest_status = str((page_jobs[0] if page_jobs else {}).get("status") or "")
    if accepted_count:
        return "covered"
    if latest_status in PENDING_DELIVERY_STATUSES or latest_status in ISSUE_DELIVERY_STATUSES:
        return "pending"
    return "ready_unverified"


def _coverage_status_summary(statuses: list[str]) -> str:
    if "blocked" in statuses:
        return "blocked"
    if statuses and all(status == "covered" for status in statuses):
        return "ready"
    return "ready_with_gaps"


def _studio_coverage(project_id: str | None = None, source_segment_id: str | None = None) -> dict[str, Any]:
    matrix = _dispatch_matrix(project_id=project_id, source_segment_id=source_segment_id)
    project = _get_project(project_id) if project_id else None
    jobs = STUDIO_STORE.list_jobs(project_id=project_id, limit=500) if project_id else STUDIO_STORE.list_jobs(limit=500)

    pages: list[dict[str, Any]] = []
    statuses: list[str] = []
    accepted_total = 0
    issue_total = 0
    pending_total = 0

    for entry in matrix["entries"]:
        page_jobs = [job for job in jobs if job.get("pageId") == entry["pageId"] or job.get("api") == entry["pageId"]]
        enriched_jobs = [_job_with_evidence(job) for job in page_jobs]
        latest_job = enriched_jobs[0] if enriched_jobs else None
        accepted_evidence = [
            evidence
            for job in enriched_jobs
            for evidence in (job or {}).get("evidenceTrail", [])
            if evidence.get("accepted")
        ]
        accepted_count = len(accepted_evidence)
        latest_evidence = (latest_job or {}).get("evidence") or (accepted_evidence[0] if accepted_evidence else {})
        status = _coverage_status(entry, page_jobs, accepted_count)
        statuses.append(status)
        accepted_total += accepted_count
        issue_total += sum(1 for job in page_jobs if str(job.get("status") or "") in ISSUE_DELIVERY_STATUSES)
        pending_total += sum(1 for job in page_jobs if str(job.get("status") or "") in PENDING_DELIVERY_STATUSES)

        pages.append(
            {
                **entry,
                "coverageStatus": status,
                "jobCount": len(page_jobs),
                "acceptedEvidence": accepted_count,
                "latestJob": latest_job,
                "latestEvidence": latest_evidence,
            }
        )

    summary = {
        **matrix["summary"],
        "covered": statuses.count("covered"),
        "pending": statuses.count("pending"),
        "readyUnverified": statuses.count("ready_unverified"),
        "acceptedEvidence": accepted_total,
        "issues": issue_total,
        "pendingJobs": pending_total,
        "withJobs": sum(1 for page in pages if page["jobCount"]),
    }
    return {
        "status": _coverage_status_summary(statuses),
        "checkedAt": now_iso(),
        "projectId": project.get("projectId") if project else None,
        "sourceSegmentId": matrix.get("sourceSegmentId"),
        "sourceMediaUrl": matrix.get("sourceMediaUrl", ""),
        "summary": summary,
        "pages": pages,
    }


def _default_dispatch_route(
    *,
    action: str = "generate",
    source_segment_id: str | None = None,
    source_segment: StudioSegment | None = None,
) -> dict[str, Any]:
    default_bot = get_bot_by_slug("seedream-multi-chart") or MYSHELL_BOTS[0]
    return {
        "bot": {
            "slug": default_bot["slug"],
            "name": default_bot["name"],
            "type": default_bot["type"],
            "rating": default_bot.get("rating", 4.5),
            "description": default_bot.get("desc", ""),
            "pageUrl": f"https://art.myshell.ai/creative/{default_bot['slug']}",
        },
        "action": _normalize_action(action),
        "sourceSegmentId": source_segment_id,
        "sourceSummary": f"Using segment {source_segment_id}" if source_segment_id else "Starting from prompt",
        "analysis": "Coverage verification queued by Studio.",
        "reason": "Batch verification for a ready dispatch target.",
        "optimizedPrompt": "Verify Studio dispatch coverage.",
        "executor": "navigation",
        "sourceMediaUrl": _accepted_source_media_url(source_segment),
    }


def _coverage_skip(page: dict[str, Any], reason: str, message: str = "") -> dict[str, Any]:
    return {
        "pageId": page["pageId"],
        "pageName": page["pageName"],
        "executor": page.get("executor", ""),
        "dispatchStatus": page.get("dispatchStatus", ""),
        "coverageStatus": page.get("coverageStatus", ""),
        "reason": reason,
        "message": message or page.get("dispatchMessage", ""),
        "missingRouteParams": page.get("missingRouteParams") or [],
    }


def _verify_navigation_page(
    project: StudioProject,
    coverage_page: dict[str, Any],
    source_segment: StudioSegment | None,
    resolved_source_segment_id: str | None,
    evidence_patch: dict[str, Any] | None = None,
    message: str | None = None,
) -> dict[str, Any]:
    page = get_page(coverage_page["pageId"])
    prompt = f"Verify {page['name']} dispatch coverage."
    route = _default_dispatch_route(source_segment_id=resolved_source_segment_id, source_segment=source_segment)
    route.update(
        {
            "page": page,
            "api": page["id"],
            "executor": page["executor"],
            "agentId": coverage_page.get("agentId") or _agent_id_for_page(page),
            "optimizedPrompt": prompt,
        }
    )
    route.update(_navigation_contract(page, route, source_segment))
    navigation_path = route.get("navigationPath", "")
    missing_route_params = _missing_route_params(page, navigation_path)
    route["routeParams"] = page.get("routeParams") or []
    route["missingRouteParams"] = missing_route_params

    segment = _append_queued_segment(project, route, prompt, "generate", resolved_source_segment_id)
    job = _create_job(project, segment, route, page, source_segment, agent_id=route["agentId"])
    segment["status"] = "done"
    segment["evidence"] = _evidence(
        "done",
        page["id"],
        accepted=True,
        message=message or f"Coverage verification prepared navigation dispatch for {page['name']} at {navigation_path}.",
    )
    segment["evidence"].update(
        {
            "pageId": page["id"],
            "agentId": job["agentId"],
            "navigationPath": navigation_path,
            "missingRouteParams": [],
            "coverageVerification": True,
        }
    )
    if evidence_patch:
        segment["evidence"].update(evidence_patch)
    segment["updatedAt"] = now_iso()
    _update_job(
        job,
        status="done",
        evidence=segment["evidence"],
        authStatus=adapter_auth_status(page["id"]),
    )
    _set_graph_status(project, route, segment)
    _append_message(
        project,
        "assistant",
        f"Verified {page['name']} navigation dispatch.",
        route=route,
        segmentId=segment["id"],
        jobId=job["jobId"],
    )
    _save_project(project)
    _sync_project_jobs(project)
    return _job_with_evidence(STUDIO_STORE.get_job(job["jobId"])) or job


def _verify_studio_coverage(
    *,
    project_id: str | None = None,
    source_segment_id: str | None = None,
    page_ids: list[str] | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    project = _project(project_id, "player")
    before = _studio_coverage(project_id=project["projectId"], source_segment_id=source_segment_id)
    resolved_source_segment_id = before.get("sourceSegmentId") or source_segment_id
    source_segment = _resolve_source_segment(project, resolved_source_segment_id)
    requested_page_ids = {page_id for page_id in (page_ids or []) if page_id}
    created_jobs: list[dict[str, Any]] = []
    skipped_pages: list[dict[str, Any]] = []

    for page in before["pages"]:
        if requested_page_ids and page["pageId"] not in requested_page_ids:
            continue
        if len(created_jobs) >= max(1, limit):
            skipped_pages.append(_coverage_skip(page, "limit_reached", "Verification limit reached."))
            continue
        if page.get("coverageStatus") == "covered":
            skipped_pages.append(_coverage_skip(page, "already_covered", "Accepted evidence already exists."))
            continue
        if page.get("missingRouteParams"):
            skipped_pages.append(_coverage_skip(page, "missing_params"))
            continue
        if not page.get("dispatchReady"):
            skipped_pages.append(_coverage_skip(page, "not_ready"))
            continue
        if page.get("executor") != "navigation":
            skipped_pages.append(
                _coverage_skip(
                    page,
                    "executor_not_batch_safe",
                    "Only navigation targets are automatically verified in batch.",
                )
            )
            continue
        created_jobs.append(
            _verify_navigation_page(
                project,
                page,
                source_segment,
                resolved_source_segment_id,
            )
        )

    _sync_project_jobs(project)
    after = _studio_coverage(project_id=project["projectId"], source_segment_id=resolved_source_segment_id)
    return {
        "status": "verified" if created_jobs else "no_verifiable_pages",
        "checkedAt": now_iso(),
        "project": project,
        "projectId": project["projectId"],
        "sourceSegmentId": after.get("sourceSegmentId"),
        "sourceMediaUrl": after.get("sourceMediaUrl", ""),
        "matchedCount": len(created_jobs) + len(skipped_pages),
        "createdCount": len(created_jobs),
        "skippedCount": len(skipped_pages),
        "jobs": created_jobs,
        "skippedPages": skipped_pages,
        "coverage": after,
    }


def _dispatch_target(entry: dict[str, Any], matrix: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"dispatch:{entry.get('pageId')}",
        "pageId": entry.get("pageId"),
        "pageName": entry.get("pageName"),
        "kind": entry.get("kind", ""),
        "executor": entry.get("executor", ""),
        "agentId": entry.get("agentId"),
        "recommendedAction": entry.get("recommendedAction"),
        "dispatchStatus": entry.get("dispatchStatus"),
        "dispatchMessage": entry.get("dispatchMessage", ""),
        "clientAction": entry.get("clientAction"),
        "navigationPath": entry.get("navigationPath", ""),
        "studioReturnPath": entry.get("studioReturnPath") or "/dreamy",
        "routeParams": entry.get("routeParams") or [],
        "missingRouteParams": [],
        "authStatus": entry.get("authStatus") or {},
        "capabilities": entry.get("capabilities") or [],
        "projectId": matrix.get("projectId"),
        "sourceSegmentId": matrix.get("sourceSegmentId"),
        "sourceMediaUrl": matrix.get("sourceMediaUrl", ""),
    }


def _dispatch_skip(entry: dict[str, Any], reason: str, message: str = "") -> dict[str, Any]:
    return {
        "id": f"skip:{entry.get('pageId')}",
        "pageId": entry.get("pageId"),
        "pageName": entry.get("pageName"),
        "kind": entry.get("kind", ""),
        "executor": entry.get("executor", ""),
        "agentId": entry.get("agentId"),
        "recommendedAction": entry.get("recommendedAction"),
        "dispatchStatus": entry.get("dispatchStatus"),
        "reason": reason,
        "message": message or entry.get("dispatchMessage", ""),
        "navigationPath": entry.get("navigationPath", ""),
        "missingRouteParams": entry.get("missingRouteParams") or [],
        "authStatus": entry.get("authStatus") or {},
    }


async def _studio_dispatch_batch_plan(
    *,
    project_id: str | None = None,
    source_segment_id: str | None = None,
    page_ids: list[str] | None = None,
    limit: int = 50,
    exclude_covered: bool = False,
) -> dict[str, Any]:
    if project_id and not _get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")

    matrix = _dispatch_matrix(project_id=project_id, source_segment_id=source_segment_id)
    coverage_by_page: dict[str, dict[str, Any]] = {}
    if exclude_covered:
        coverage = _studio_coverage(
            project_id=matrix.get("projectId") or project_id,
            source_segment_id=matrix.get("sourceSegmentId") or source_segment_id,
        )
        coverage_by_page = {page["pageId"]: page for page in coverage.get("pages") or []}
    requested_page_ids = {page_id for page_id in (page_ids or []) if page_id}
    max_targets = max(1, min(limit, 100))
    selected_entries = [
        entry for entry in matrix.get("entries", []) if not requested_page_ids or entry.get("pageId") in requested_page_ids
    ]
    targets: list[dict[str, Any]] = []
    skipped_targets: list[dict[str, Any]] = []

    for entry in selected_entries:
        coverage_entry = coverage_by_page.get(str(entry.get("pageId") or ""))
        if exclude_covered and coverage_entry and coverage_entry.get("coverageStatus") == "covered":
            skipped = _dispatch_skip(entry, "already_covered", "Accepted coverage evidence already exists.")
            skipped["coverageStatus"] = "covered"
            skipped["latestEvidence"] = coverage_entry.get("latestEvidence") or {}
            skipped_targets.append(skipped)
            continue
        if len(targets) >= max_targets:
            skipped_targets.append(_dispatch_skip(entry, "limit_reached", "Dispatch batch limit reached."))
            continue
        if entry.get("missingRouteParams"):
            skipped_targets.append(_dispatch_skip(entry, "missing_params"))
            continue
        if not entry.get("dispatchReady"):
            skipped_targets.append(_dispatch_skip(entry, str(entry.get("dispatchStatus") or "not_ready")))
            continue
        targets.append(_dispatch_target(entry, matrix))

    summary = {
        "total": len(selected_entries),
        "planned": len(targets),
        "skipped": len(skipped_targets),
        "navigation": sum(1 for target in targets if target.get("executor") == "navigation"),
        "client": sum(1 for target in targets if target.get("executor") == "client"),
        "server": sum(1 for target in targets if target.get("executor") == "server"),
        "missingParams": sum(1 for target in skipped_targets if target.get("reason") == "missing_params"),
        "blocked": sum(1 for target in skipped_targets if target.get("reason") in {"auth_missing", "error", "not_ready"}),
        "coveredSkipped": sum(1 for target in skipped_targets if target.get("reason") == "already_covered"),
    }
    handoff = await _studio_handoff_snapshot(
        project_id=matrix.get("projectId") or project_id,
        source_segment_id=matrix.get("sourceSegmentId") or source_segment_id,
    )
    return {
        "status": "planned" if targets else "blocked",
        "readyForDispatch": bool(targets),
        "checkedAt": now_iso(),
        "projectId": matrix.get("projectId"),
        "sourceSegmentId": matrix.get("sourceSegmentId"),
        "sourceMediaUrl": matrix.get("sourceMediaUrl", ""),
        "excludeCovered": exclude_covered,
        "summary": summary,
        "targets": targets,
        "skippedTargets": skipped_targets,
        "matrix": matrix,
        "handoffSnapshot": handoff,
    }


def _dispatch_session_next_target(targets: list[dict[str, Any]]) -> dict[str, Any] | None:
    return next(
        (
            target
            for target in targets
            if target.get("status", "pending") == "pending"
            and target.get("executor") == "navigation"
            and target.get("navigationPath")
        ),
        None,
    ) or next((target for target in targets if target.get("status", "pending") == "pending"), None)


def _dispatch_session_view(session: dict[str, Any]) -> dict[str, Any]:
    targets = session.get("targets") or []
    for target in targets:
        target.setdefault("status", "pending")
    completed = sum(1 for target in targets if target.get("status") == "completed")
    visited = sum(1 for target in targets if target.get("status") == "visited")
    pending = sum(1 for target in targets if target.get("status") == "pending")
    skipped_targets = sum(1 for target in targets if target.get("status") == "skipped")
    errors = sum(1 for target in targets if target.get("status") == "error")
    cancelled_targets = sum(1 for target in targets if target.get("status") == "cancelled")
    summary = dict(session.get("summary") or {})
    summary.update(
        {
            "pending": pending,
            "visited": visited,
            "completed": completed,
            "targetSkipped": skipped_targets,
            "targetErrors": errors,
            "targetCancelled": cancelled_targets,
        }
    )
    if not targets:
        status = "blocked"
    elif pending > 0:
        status = "active"
    elif visited > 0 or errors > 0:
        status = "needs_review"
    else:
        status = "done"

    view = dict(session)
    view["targets"] = targets
    view["summary"] = summary
    view["status"] = status if session.get("status") != "cancelled" else "cancelled"
    view["readyForDispatch"] = bool(targets) and view["status"] in {"active", "needs_review", "done"}
    view["nextTarget"] = None if view["status"] == "cancelled" else _dispatch_session_next_target(targets)
    return view


async def _create_dispatch_session(
    *,
    project_id: str | None = None,
    source_segment_id: str | None = None,
    page_ids: list[str] | None = None,
    limit: int = 50,
    exclude_covered: bool = False,
) -> dict[str, Any]:
    plan = await _studio_dispatch_batch_plan(
        project_id=project_id,
        source_segment_id=source_segment_id,
        page_ids=page_ids,
        limit=limit,
        exclude_covered=exclude_covered,
    )
    now = now_iso()
    targets = [{**target, "status": "pending", "evidence": {}} for target in plan.get("targets", [])]
    session = {
        "sessionId": make_id("dispatch_session"),
        "status": "active" if targets else "blocked",
        "createdAt": now,
        "updatedAt": now,
        "checkedAt": plan.get("checkedAt") or now,
        "projectId": plan.get("projectId"),
        "sourceSegmentId": plan.get("sourceSegmentId"),
        "sourceMediaUrl": plan.get("sourceMediaUrl", ""),
        "excludeCovered": bool(plan.get("excludeCovered")),
        "summary": plan.get("summary") or {},
        "targets": targets,
        "skippedTargets": plan.get("skippedTargets") or [],
        "matrix": plan.get("matrix") or {},
        "handoffSnapshot": plan.get("handoffSnapshot") or {},
        "planStatus": plan.get("status"),
    }
    view = _dispatch_session_view(session)
    STUDIO_STORE.save_dispatch_session(view)
    return view


def _get_dispatch_session_or_404(session_id: str) -> dict[str, Any]:
    session = STUDIO_STORE.get_dispatch_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Dispatch session not found")
    return _dispatch_session_view(session)


def _dispatch_session_with_focused_target(session: dict[str, Any], target_id: str | None = None) -> dict[str, Any]:
    view = dict(session)
    if not target_id:
        return view
    targets = view.get("targets") or []
    focused_index = next((index for index, target in enumerate(targets) if target.get("id") == target_id), -1)
    view["focusedTargetId"] = target_id
    view["focusedTargetIndex"] = focused_index
    view["focusedTarget"] = targets[focused_index] if focused_index >= 0 else None
    return view


def _record_dispatch_session_target_completion(
    session: dict[str, Any],
    target: dict[str, Any],
    operator_evidence: dict[str, Any],
) -> dict[str, Any] | None:
    if target.get("executor") != "navigation":
        return None
    if target.get("evidenceJobId"):
        existing_job = _job_with_evidence(STUDIO_STORE.get_job(str(target["evidenceJobId"])))
        if existing_job:
            target["jobId"] = existing_job["jobId"]
            target["evidence"] = {
                **(target.get("evidence") or {}),
                **(existing_job.get("evidence") or {}),
            }
        return existing_job

    project_id = target.get("projectId") or session.get("projectId")
    project = _get_project(str(project_id)) if project_id else None
    if not project:
        return None

    source_segment_id = target.get("sourceSegmentId") or session.get("sourceSegmentId")
    source_segment = _resolve_source_segment(project, str(source_segment_id) if source_segment_id else None)
    resolved_source_segment_id = source_segment.get("id") if source_segment else source_segment_id
    evidence_patch = {
        "coverageVerification": True,
        "dispatchSessionId": session["sessionId"],
        "dispatchTargetId": target["id"],
        "operatorEvidence": operator_evidence,
    }
    job = _verify_navigation_page(
        project,
        {
            "pageId": target["pageId"],
            "pageName": target.get("pageName") or target["pageId"],
            "agentId": target.get("agentId"),
        },
        source_segment,
        str(resolved_source_segment_id) if resolved_source_segment_id else None,
        evidence_patch=evidence_patch,
        message=f"Dispatch session marked {target.get('pageName') or target['pageId']} complete.",
    )
    target["evidenceJobId"] = job["jobId"]
    target["jobId"] = job["jobId"]
    target["evidence"] = {
        **(target.get("evidence") or {}),
        **(job.get("evidence") or {}),
    }
    return job


def _update_dispatch_session_target(
    session_id: str,
    target_id: str,
    *,
    status: str,
    evidence: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if status not in VALID_DISPATCH_TARGET_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid dispatch target status")
    session = STUDIO_STORE.get_dispatch_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Dispatch session not found")

    target = next((entry for entry in session.get("targets", []) if entry.get("id") == target_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Dispatch target not found")

    now = now_iso()
    target["status"] = status
    target["updatedAt"] = now
    if status == "visited":
        target["visitedAt"] = now
    if status == "completed":
        target["completedAt"] = now
    if status == "skipped":
        target["skippedAt"] = now
    if status == "error":
        target["erroredAt"] = now
    current_evidence = target.get("evidence") if isinstance(target.get("evidence"), dict) else {}
    if evidence:
        target["evidence"] = {**current_evidence, **evidence}
    if status == "completed":
        operator_evidence = target.get("evidence") if isinstance(target.get("evidence"), dict) else {}
        _record_dispatch_session_target_completion(session, target, operator_evidence)

    session["updatedAt"] = now
    view = _dispatch_session_view(session)
    STUDIO_STORE.save_dispatch_session(view)
    return view


def _run_dispatch_session_target(session_id: str, target_id: str) -> dict[str, Any]:
    session = STUDIO_STORE.get_dispatch_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Dispatch session not found")

    target = next((entry for entry in session.get("targets", []) if entry.get("id") == target_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Dispatch target not found")

    target_status = str(target.get("status") or "pending")
    if target_status not in {"pending", "visited"}:
        raise HTTPException(status_code=409, detail=f"Dispatch target cannot run from status {target_status}")

    page = get_page(str(target.get("pageId") or ""))
    project_id = target.get("projectId") or session.get("projectId")
    if not project_id:
        project = _project(None, "player")
        project_id = project["projectId"]
        session["projectId"] = project_id
        target["projectId"] = project_id
    else:
        project = _get_project(str(project_id))
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

    source_segment_id = target.get("sourceSegmentId") or session.get("sourceSegmentId")
    source_segment = _resolve_source_segment(project, str(source_segment_id) if source_segment_id else None)
    resolved_source_segment_id = source_segment.get("id") if source_segment else source_segment_id
    now = now_iso()

    if page.get("executor") == "navigation":
        target_path = str(target.get("navigationPath") or "")
        current_evidence = target.get("evidence") if isinstance(target.get("evidence"), dict) else {}
        target["status"] = "visited"
        target["visitedAt"] = target.get("visitedAt") or now
        target["updatedAt"] = now
        target["evidence"] = {
            **current_evidence,
            "openedFrom": "studio-target-run",
            "dispatchSessionId": session_id,
            "dispatchTargetId": target_id,
            "pageId": page["id"],
            "navigationPath": target_path,
        }
        session["updatedAt"] = now
        view = _dispatch_session_view(session)
        STUDIO_STORE.save_dispatch_session(view)
        return {
            "status": "navigation_required",
            "checkedAt": now,
            "session": _dispatch_session_with_focused_target(view, target_id),
            "target": next(entry for entry in view.get("targets", []) if entry.get("id") == target_id),
            "navigationPath": target_path,
        }

    route = _default_dispatch_route(
        source_segment_id=str(resolved_source_segment_id) if resolved_source_segment_id else None,
        source_segment=source_segment,
    )
    route.update(
        {
            "page": page,
            "api": page["id"],
            "executor": page["executor"],
            "agentId": target.get("agentId") or _agent_id_for_page(page),
            "analysis": "Dispatch session target materialized into an executable adapter request.",
            "reason": "Operator ran a queued Studio dispatch target.",
            "optimizedPrompt": f"Dispatch {page['name']} from Studio queue.",
        }
    )
    prompt = str(route.get("optimizedPrompt") or f"Dispatch {page['name']}")
    segment = _append_queued_segment(
        project,
        route,
        prompt,
        "generate",
        str(resolved_source_segment_id) if resolved_source_segment_id else None,
    )
    job = _create_job(project, segment, route, page, source_segment, agent_id=str(route.get("agentId") or ""))
    evidence = {
        **(job.get("evidence") or {}),
        "dispatchSessionId": session_id,
        "dispatchTargetId": target_id,
        "dispatchTargetPageId": page["id"],
    }
    segment["evidence"] = evidence
    segment["updatedAt"] = now
    job = _update_job(job, evidence=evidence, authStatus=adapter_auth_status(page["id"]))
    _set_graph_status(project, route, segment)
    _append_message(
        project,
        "assistant",
        f"Queued {page['name']} dispatch target.",
        route=route,
        segmentId=segment["id"],
        jobId=job["jobId"],
    )

    current_evidence = target.get("evidence") if isinstance(target.get("evidence"), dict) else {}
    target["status"] = "visited"
    target["visitedAt"] = target.get("visitedAt") or now
    target["updatedAt"] = now
    target["jobId"] = job["jobId"]
    target["segmentId"] = segment["id"]
    target["evidence"] = {
        **current_evidence,
        "dispatchSessionId": session_id,
        "dispatchTargetId": target_id,
        "jobId": job["jobId"],
        "segmentId": segment["id"],
        "runFrom": "studio",
    }
    session["updatedAt"] = now
    view = _dispatch_session_view(session)
    STUDIO_STORE.save_dispatch_session(view)
    _save_project(project)
    _sync_project_jobs(project)

    return {
        "status": "execution_required",
        "checkedAt": now,
        "session": _dispatch_session_with_focused_target(view, target_id),
        "target": next(entry for entry in view.get("targets", []) if entry.get("id") == target_id),
        "job": _job_with_evidence(job),
        "project": project,
        "executionRequest": _build_execution_request(project, job),
    }


def _cancel_dispatch_session(session_id: str) -> dict[str, Any]:
    session = STUDIO_STORE.get_dispatch_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Dispatch session not found")

    now = now_iso()
    for target in session.get("targets", []):
        if target.get("status", "pending") not in {"pending", "visited"}:
            continue
        current_evidence = target.get("evidence") if isinstance(target.get("evidence"), dict) else {}
        target["status"] = "cancelled"
        target["cancelledAt"] = now
        target["updatedAt"] = now
        target["evidence"] = {
            **current_evidence,
            "cancelledFrom": "studio",
        }

    session["status"] = "cancelled"
    session["cancelledAt"] = now
    session["updatedAt"] = now
    view = _dispatch_session_view(session)
    STUDIO_STORE.save_dispatch_session(view)
    return view


def _retry_dispatch_session(session_id: str) -> dict[str, Any]:
    session = STUDIO_STORE.get_dispatch_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Dispatch session not found")

    now = now_iso()
    reopened = 0
    for target in session.get("targets", []):
        previous_status = str(target.get("status") or "pending")
        if previous_status not in {"cancelled", "error"}:
            continue
        current_evidence = target.get("evidence") if isinstance(target.get("evidence"), dict) else {}
        target["status"] = "pending"
        target["retriedAt"] = now
        target["updatedAt"] = now
        target["evidence"] = {
            **current_evidence,
            "retriedFrom": previous_status,
            "retriedAt": now,
        }
        reopened += 1

    if reopened == 0:
        raise HTTPException(status_code=409, detail="Dispatch session has no cancelled or error targets to retry")

    session["status"] = "active"
    session["retriedAt"] = now
    session["retryCount"] = int(session.get("retryCount") or 0) + 1
    session["updatedAt"] = now
    view = _dispatch_session_view(session)
    STUDIO_STORE.save_dispatch_session(view)
    return view


def _gate_status_from_report(status: str) -> str:
    if status in {"ok", "ready"}:
        return "ready"
    if status in {"blocked", "auth_missing", "error"}:
        return "blocked"
    return "needs_attention"


def _artifact_url(
    endpoint: str,
    *,
    project_id: str | None = None,
    session_id: str | None = None,
    query: dict[str, Any] | None = None,
) -> str:
    url = endpoint
    if project_id is not None:
        url = url.replace("{project_id}", quote(str(project_id), safe=""))
    if session_id is not None:
        url = url.replace("{session_id}", quote(str(session_id), safe=""))
    clean_query = {
        key: value
        for key, value in (query or {}).items()
        if value is not None and value != ""
    }
    if clean_query:
        delimiter = "&" if "?" in url else "?"
        url = f"{url}{delimiter}{urlencode(clean_query)}"
    return url


def _artifact(
    artifact_id: str,
    label: str,
    endpoint: str,
    *,
    project_id: str | None = None,
    session_id: str | None = None,
    target_id: str | None = None,
    ui_url: str | None = None,
    query: dict[str, Any] | None = None,
    filename: str | None = None,
) -> dict[str, Any]:
    artifact = {
        "id": artifact_id,
        "label": label,
        "endpoint": endpoint,
        "url": _artifact_url(endpoint, project_id=project_id, session_id=session_id, query=query),
    }
    if project_id is not None:
        artifact["projectId"] = project_id
    if session_id is not None:
        artifact["sessionId"] = session_id
    if target_id is not None:
        artifact["targetId"] = target_id
    if ui_url:
        artifact["uiUrl"] = ui_url
    clean_query = {
        key: value
        for key, value in (query or {}).items()
        if value is not None and value != ""
    }
    if clean_query:
        artifact["query"] = clean_query
    if filename:
        artifact["filename"] = filename
    return artifact


def _context_query(project_id: str | None = None, source_segment_id: str | None = None) -> dict[str, Any]:
    query: dict[str, Any] = {}
    if project_id:
        query["project_id"] = project_id
    if source_segment_id:
        query["source_segment_id"] = source_segment_id
    return query


def _dispatch_session_ui_url(session_id: str, target_id: str | None = None) -> str:
    query = {"dispatch_session_id": session_id}
    if target_id:
        query["target_id"] = target_id
    return f"/dreamy?{urlencode(query)}"


def _handoff_artifacts(project_id: str | None, source_segment_id: str | None = None) -> list[dict[str, Any]]:
    context_query = _context_query(project_id, source_segment_id)
    artifacts = [
        _artifact("health", "Health", "/api/health"),
        _artifact("readiness", "Readiness", "/api/studio/readiness"),
        _artifact("overview", "Overview", "/api/studio/overview"),
        _artifact("dispatch-matrix", "Dispatch Matrix", "/api/studio/dispatch-matrix", query=context_query),
        _artifact("coverage", "Coverage", "/api/studio/coverage", query=context_query),
        _artifact("handoff-snapshot", "Handoff Snapshot", "/api/studio/handoff-snapshot", query=context_query),
    ]
    if project_id:
        artifacts.append(
            _artifact(
                "delivery-report",
                "Project Delivery Report",
                "/api/studio/projects/{project_id}/delivery-report",
                project_id=project_id,
            )
        )
    return artifacts


def _delivery_bundle_artifacts(
    project_id: str,
    sessions: list[dict[str, Any]],
    source_segment_id: str | None = None,
) -> list[dict[str, Any]]:
    bundle_query = _context_query(source_segment_id=source_segment_id)
    artifacts = [
        *_handoff_artifacts(project_id, source_segment_id),
        _artifact("project", "Project", "/api/studio/projects/{project_id}", project_id=project_id),
        _artifact(
            "delivery-bundle",
            "Delivery Bundle",
            "/api/studio/projects/{project_id}/delivery-bundle",
            project_id=project_id,
            query=bundle_query,
        ),
        _artifact("jobs", "Jobs", "/api/studio/jobs", project_id=project_id, query={"project_id": project_id}),
    ]
    for session in sessions:
        session_id = str(session.get("sessionId") or "")
        artifacts.append(
            _artifact(
                f"dispatch-session:{session_id}",
                f"Dispatch Session {session_id}",
                "/api/studio/dispatch-sessions/{session_id}",
                project_id=project_id,
                session_id=session_id,
                ui_url=_dispatch_session_ui_url(session_id),
            )
        )
        for target in session.get("targets") or []:
            target_id = str(target.get("id") or "")
            if not target_id:
                continue
            artifacts.append(
                _artifact(
                    f"dispatch-target:{session_id}:{target_id}",
                    f"Dispatch Target {target.get('pageName') or target.get('pageId') or target_id}",
                    "/api/studio/dispatch-sessions/{session_id}",
                    project_id=project_id,
                    session_id=session_id,
                    target_id=target_id,
                    ui_url=_dispatch_session_ui_url(session_id, target_id),
                    query={"target_id": target_id},
                )
            )
    return artifacts


def _coverage_gap_action(page: dict[str, Any]) -> tuple[str, str]:
    missing_params = page.get("missingRouteParams") or []
    dispatch_status = str(page.get("dispatchStatus") or "")
    coverage_status = str(page.get("coverageStatus") or "")
    if dispatch_status == "auth_missing":
        return "auth_missing", "restore-auth"
    if missing_params:
        return "missing_params", "provide-route-params"
    if coverage_status == "ready_unverified":
        return "ready_unverified", "verify-ready"
    if coverage_status == "pending":
        return "pending", "wait-or-refresh"
    if dispatch_status in {"error", "timeout"}:
        return dispatch_status, "retry-or-inspect"
    if not page.get("dispatchReady"):
        return dispatch_status or coverage_status or "not_ready", "restore-readiness"
    return coverage_status or dispatch_status or "needs_attention", "inspect-gap"


def _handoff_gaps_and_actions(
    coverage: dict[str, Any],
    delivery_report: dict[str, Any] | None,
    project_id: str | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    gaps: list[dict[str, Any]] = []
    actions: list[dict[str, Any]] = []
    for page in coverage.get("pages") or []:
        if page.get("coverageStatus") == "covered":
            continue
        reason, action = _coverage_gap_action(page)
        gap = {
            "id": f"coverage:{page.get('pageId')}",
            "kind": "page",
            "pageId": page.get("pageId"),
            "pageName": page.get("pageName"),
            "status": page.get("coverageStatus"),
            "reason": reason,
            "message": page.get("dispatchMessage") or (page.get("latestEvidence") or {}).get("message") or "",
            "missingRouteParams": page.get("missingRouteParams") or [],
        }
        gaps.append(gap)
        actions.append(
            {
                "id": f"{action}:{page.get('pageId')}",
                "action": action,
                "kind": "page",
                "targetId": page.get("pageId"),
                "targetName": page.get("pageName"),
                "status": page.get("coverageStatus"),
                "reason": reason,
                "message": gap["message"],
            }
        )

    for unresolved in (delivery_report or {}).get("unresolvedActions") or []:
        actions.append(
            {
                "id": f"job:{unresolved.get('action')}:{unresolved.get('jobId') or unresolved.get('segmentId')}",
                "action": unresolved.get("action"),
                "kind": "job",
                "targetId": unresolved.get("jobId") or unresolved.get("segmentId"),
                "targetName": unresolved.get("botName") or unresolved.get("pageId"),
                "status": unresolved.get("status"),
                "reason": unresolved.get("action"),
                "message": unresolved.get("message") or "",
                "pageId": unresolved.get("pageId"),
                "segmentId": unresolved.get("segmentId"),
                "jobId": unresolved.get("jobId"),
            }
        )

    if project_id:
        for session in STUDIO_STORE.list_dispatch_sessions(project_id=project_id, limit=50):
            session_view = _dispatch_session_view(session)
            session_id = str(session_view.get("sessionId") or "")
            for target in session_view.get("targets") or []:
                target_status = str(target.get("status") or "pending")
                if target_status not in {"pending", "visited", "error", "cancelled"}:
                    continue
                target_id = str(target.get("id") or "")
                evidence = target.get("evidence") if isinstance(target.get("evidence"), dict) else {}
                if target_status == "pending":
                    reason = "pending"
                    action = "run-target"
                    message = str(target.get("message") or evidence.get("message") or "Dispatch target is pending; run it from the Studio queue.")
                elif target_status == "visited":
                    reason = "visited"
                    action = "inspect-gap"
                    message = str(
                        target.get("message")
                        or evidence.get("message")
                        or "Dispatch target was opened but has not been marked done, skipped, or error."
                    )
                elif target_status == "cancelled":
                    reason = "cancelled"
                    action = "retry-queue"
                    message = str(
                        target.get("message")
                        or evidence.get("message")
                        or "Dispatch target was cancelled before completion; retry the queue to reopen it."
                    )
                else:
                    reason = "error"
                    action = "inspect-gap"
                    message = str(target.get("message") or evidence.get("message") or "Dispatch target needs operator review.")

                gap = {
                    "id": f"dispatch-session:{session_id}:{target_id}",
                    "kind": "dispatch_target",
                    "pageId": target.get("pageId"),
                    "pageName": target.get("pageName"),
                    "status": target_status,
                    "reason": reason,
                    "message": message,
                    "missingRouteParams": target.get("missingRouteParams") or [],
                    "sessionId": session_id,
                    "targetId": target_id,
                }
                gaps.append(gap)
                actions.append(
                    {
                        "id": f"dispatch-target:{action}:{session_id}:{target_id}",
                        "action": action,
                        "kind": "dispatch_target",
                        "targetId": target_id,
                        "targetName": target.get("pageName") or target.get("pageId"),
                        "status": target_status,
                        "reason": reason,
                        "message": message,
                        "pageId": target.get("pageId"),
                        "sessionId": session_id,
                        "uiUrl": _dispatch_session_ui_url(session_id, target_id),
                    }
                )
    return gaps, [_action_with_operator_instruction(action) for action in actions]


def _handoff_status(
    *,
    readiness: dict[str, Any],
    coverage: dict[str, Any],
    delivery_report: dict[str, Any] | None,
    gaps: list[dict[str, Any]],
) -> str:
    if readiness.get("status") == "blocked":
        return "blocked"
    if coverage.get("status") == "blocked" or coverage.get("summary", {}).get("blocked", 0) > 0:
        return "blocked"
    if (delivery_report or {}).get("handoffStatus") == "needs_attention":
        return "blocked"
    if gaps:
        return "needs_attention"
    if (delivery_report or {}).get("handoffStatus") == "in_progress":
        return "needs_attention"
    return "ready"


async def _studio_handoff_snapshot(
    project_id: str | None = None,
    source_segment_id: str | None = None,
) -> dict[str, Any]:
    project = _get_project(project_id) if project_id else None
    if project_id and not project:
        raise HTTPException(status_code=404, detail="Project not found")

    health = await runtime_health(STUDIO_STORE.path)
    readiness = await _studio_readiness()
    overview = _studio_overview(limit=50)
    dispatch_matrix = _dispatch_matrix(project_id=project_id, source_segment_id=source_segment_id)
    coverage = _studio_coverage(project_id=project_id, source_segment_id=source_segment_id)
    delivery_report = _project_delivery_report(project) if project else None
    gaps, actions = _handoff_gaps_and_actions(coverage, delivery_report, project_id=project_id)
    status = _handoff_status(
        readiness=readiness,
        coverage=coverage,
        delivery_report=delivery_report,
        gaps=gaps,
    )
    coverage_summary = coverage.get("summary") or {}
    delivery_summary = (delivery_report or {}).get("summary") or {}
    overview_totals = overview.get("totals") or {}

    gates = [
        {
            "id": "health",
            "label": "Health",
            "status": _gate_status_from_report(str(health.get("status") or "unknown")),
            "message": str(health.get("status") or ""),
            "required": True,
        },
        {
            "id": "readiness",
            "label": "Studio Readiness",
            "status": _gate_status_from_report(str(readiness.get("status") or "unknown")),
            "message": f"{readiness.get('summary', {}).get('ready', 0)}/{readiness.get('summary', {}).get('total', 0)} gates ready",
            "required": True,
        },
        {
            "id": "coverage",
            "label": "Page Coverage",
            "status": _gate_status_from_report(str(coverage.get("status") or "unknown")),
            "message": f"{coverage_summary.get('covered', 0)}/{coverage_summary.get('total', 0)} pages covered",
            "required": True,
        },
        {
            "id": "dispatch-matrix",
            "label": "Dispatch Matrix",
            "status": "ready"
            if dispatch_matrix.get("summary", {}).get("ready", 0) >= dispatch_matrix.get("summary", {}).get("total", 0)
            else "needs_attention",
            "message": f"{dispatch_matrix.get('summary', {}).get('ready', 0)}/{dispatch_matrix.get('summary', {}).get('total', 0)} targets ready",
            "required": True,
        },
    ]
    if delivery_report:
        gates.append(
            {
                "id": "project-delivery",
                "label": "Project Delivery",
                "status": _gate_status_from_report(str(delivery_report.get("handoffStatus") or "unknown")),
                "message": f"{delivery_summary.get('acceptedEvidence', 0)} accepted evidence items",
                "required": True,
            }
        )

    return {
        "status": status,
        "readyForDelivery": status == "ready",
        "checkedAt": now_iso(),
        "projectId": project.get("projectId") if project else None,
        "sourceSegmentId": coverage.get("sourceSegmentId"),
        "sourceMediaUrl": coverage.get("sourceMediaUrl", ""),
        "summary": {
            "pages": coverage_summary.get("total", 0),
            "covered": coverage_summary.get("covered", 0),
            "pending": coverage_summary.get("pending", 0),
            "readyUnverified": coverage_summary.get("readyUnverified", 0),
            "blocked": coverage_summary.get("blocked", 0),
            "acceptedEvidence": coverage_summary.get("acceptedEvidence", 0),
            "jobs": overview_totals.get("jobs", 0),
            "issues": overview_totals.get("issues", 0) + coverage_summary.get("issues", 0),
            "deliveryAcceptedEvidence": delivery_summary.get("acceptedEvidence", 0),
            "deliveryPendingEvidence": delivery_summary.get("pendingEvidence", 0),
            "unresolvedActions": len(actions),
            "gaps": len(gaps),
        },
        "gates": gates,
        "gaps": gaps,
        "actions": actions,
        "artifacts": _handoff_artifacts(project.get("projectId") if project else None, coverage.get("sourceSegmentId")),
        "reports": {
            "health": health,
            "readiness": readiness,
            "overview": overview,
            "dispatchMatrix": dispatch_matrix,
            "coverage": coverage,
            "deliveryReport": delivery_report,
        },
    }


def _delivery_gate(
    gate_id: str,
    label: str,
    status: str,
    *,
    required: bool = True,
    message: str = "",
    evidence: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "id": gate_id,
        "label": label,
        "status": "ready" if status in READY_GATE_STATUSES else status,
        "required": required,
        "message": message,
        "evidence": evidence or {},
    }


def _component_gate_status(component: dict[str, Any] | None, *, required: bool = True) -> str:
    status = str((component or {}).get("status") or "unknown")
    if status in READY_GATE_STATUSES:
        return "ready"
    if status == "auth_missing":
        return "auth_missing"
    if status in {"unavailable", "degraded"}:
        return status
    return "blocked" if required else "degraded"


def _readiness_summary(gates: list[dict[str, Any]]) -> dict[str, int]:
    summary = {"ready": 0, "degraded": 0, "blocked": 0, "total": len(gates)}
    for gate in gates:
        status = str(gate.get("status") or "unknown")
        if status == "ready":
            summary["ready"] += 1
        elif status in BLOCKED_GATE_STATUSES:
            summary["blocked"] += 1
        else:
            summary["degraded"] += 1
    return summary


def _readiness_status(gates: list[dict[str, Any]]) -> str:
    if any(gate.get("required") and gate.get("status") in BLOCKED_GATE_STATUSES for gate in gates):
        return "blocked"
    if any(gate.get("status") != "ready" for gate in gates):
        return "degraded"
    return "ready"


def _audit_status(requirements: list[dict[str, Any]]) -> str:
    if any(item.get("required") and item.get("status") in {"blocked", "error"} for item in requirements):
        return "blocked"
    if any(item.get("status") != "ready" for item in requirements):
        return "degraded"
    return "ready"


def _requirement(
    requirement_id: str,
    label: str,
    status: str,
    *,
    required: bool = True,
    message: str = "",
    evidence: dict[str, Any] | None = None,
) -> dict[str, Any]:
    normalized_status = "ready" if status in READY_GATE_STATUSES else status
    return {
        "id": requirement_id,
        "label": label,
        "status": normalized_status,
        "required": required,
        "message": message,
        "evidence": evidence or {},
    }


def _requirement_from_gate(gate: dict[str, Any]) -> dict[str, Any]:
    return _requirement(
        str(gate.get("id") or ""),
        str(gate.get("label") or gate.get("id") or ""),
        str(gate.get("status") or "unknown"),
        required=bool(gate.get("required", True)),
        message=str(gate.get("message") or ""),
        evidence=gate.get("evidence") if isinstance(gate.get("evidence"), dict) else {},
    )


def _audit_action_for_requirement(requirement: dict[str, Any]) -> dict[str, Any] | None:
    status = str(requirement.get("status") or "")
    if status == "ready":
        return None
    requirement_id = str(requirement.get("id") or "")
    label = str(requirement.get("label") or requirement_id)
    action = "inspect-requirement"
    if status in {"auth_missing", "needs_configuration"} or "auth" in requirement_id or "cookie" in requirement_id:
        action = "restore-auth"
    elif requirement_id == "chrome-cdp":
        action = "start-chrome-cdp"
    elif requirement_id == "handoff-snapshot":
        action = "provide-project-id"
    elif requirement_id == "dispatch-matrix":
        action = "inspect-dispatch-matrix"
    return {
        "id": f"audit:{action}:{requirement_id}",
        "action": action,
        "kind": "requirement",
        "targetId": requirement_id,
        "targetName": label,
        "status": status,
        "reason": status,
        "message": str(requirement.get("message") or ""),
    }


def _delivery_audit_actions(
    requirements: list[dict[str, Any]],
    handoff: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    for requirement in requirements:
        action = _audit_action_for_requirement(requirement)
        if action:
            actions.append(action)
    if handoff and isinstance(handoff.get("actions"), list):
        actions.extend(list(handoff.get("actions") or []))
    deduped: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for action in actions:
        action_id = str(action.get("id") or "")
        if action_id and action_id in seen_ids:
            continue
        if action_id:
            seen_ids.add(action_id)
        deduped.append(_action_with_operator_instruction(action))
    return deduped


async def _studio_readiness() -> dict[str, Any]:
    health = await runtime_health(STUDIO_STORE.path)
    components = health.get("components") or {}
    pages = list_studio_pages()
    agents = list_studio_agents()
    page_ids = {page["id"] for page in pages}
    agent_ids = {agent["id"] for agent in agents}
    missing_page_ids = sorted(CORE_DELIVERY_PAGE_IDS - page_ids)
    missing_agent_ids = sorted(CORE_DELIVERY_AGENT_IDS - agent_ids)
    route_coverage = _frontend_route_coverage(pages)
    route_coverage_ready = route_coverage.get("status") in {"covered", "source_unavailable"}
    page_registry_ready = not missing_page_ids and route_coverage_ready

    gates = [
        _delivery_gate(
            "backend",
            "Backend",
            _component_gate_status(components.get("backend")),
            message=str((components.get("backend") or {}).get("message") or "FastAPI runtime is serving requests"),
            evidence=components.get("backend") or {},
        ),
        _delivery_gate(
            "storage",
            "Storage",
            _component_gate_status(components.get("storage")),
            message=str((components.get("storage") or {}).get("path") or STUDIO_STORE.path),
            evidence=components.get("storage") or {"path": STUDIO_STORE.path},
        ),
        _delivery_gate(
            "chrome-cdp",
            "Chrome CDP",
            _component_gate_status(components.get("chromeCdp"), required=False),
            required=False,
            message=str((components.get("chromeCdp") or {}).get("url") or ""),
            evidence=components.get("chromeCdp") or {},
        ),
        _delivery_gate(
            "cookie-injection",
            "Cookie Injection",
            _component_gate_status(components.get("cookieInjection"), required=False),
            required=False,
            message=str((components.get("cookieInjection") or {}).get("message") or ""),
            evidence=components.get("cookieInjection") or {},
        ),
        _delivery_gate(
            "page-registry",
            "Page Registry",
            "ready" if page_registry_ready else "blocked",
            message=f"{len(pages)} registered MyShell pages; {route_coverage.get('message')}",
            evidence={
                "pageCount": len(pages),
                "missingPageIds": missing_page_ids,
                "routeCoverage": route_coverage,
            },
        ),
        _delivery_gate(
            "agent-registry",
            "Agent Registry",
            "ready" if not missing_agent_ids else "blocked",
            message=f"{len(agents)} registered Studio agents",
            evidence={"agentCount": len(agents), "missingAgentIds": missing_agent_ids},
        ),
    ]

    try:
        preview = await _dispatch_preview(
            message="open my generated library",
            action="generate",
            page_id="library",
        )
        preview_ready = (
            preview.get("executor") == "navigation"
            and preview.get("clientAction") == "navigate"
            and preview.get("navigationPath") == "/library"
            and not preview.get("missingRouteParams")
        )
        gates.append(
            _delivery_gate(
                "dispatch-preview",
                "Dispatch Preview",
                "ready" if preview_ready else "blocked",
                message=str(preview.get("navigationPath") or ""),
                evidence={
                    "pageId": (preview.get("page") or {}).get("id"),
                    "agentId": preview.get("agentId"),
                    "executor": preview.get("executor"),
                    "navigationPath": preview.get("navigationPath"),
                    "missingRouteParams": preview.get("missingRouteParams") or [],
                },
            )
        )
    except Exception as exc:
        gates.append(
            _delivery_gate(
                "dispatch-preview",
                "Dispatch Preview",
                "blocked",
                message=str(exc),
            )
        )

    try:
        overview = _studio_overview(limit=10)
        overview_ready = overview.get("totals", {}).get("pages", 0) >= len(CORE_DELIVERY_PAGE_IDS)
        gates.append(
            _delivery_gate(
                "overview",
                "Studio Overview",
                "ready" if overview_ready else "blocked",
                message=f"{overview.get('totals', {}).get('jobs', 0)} jobs indexed",
                evidence={
                    "pageCount": overview.get("totals", {}).get("pages", 0),
                    "agentCount": overview.get("totals", {}).get("agents", 0),
                    "jobCount": overview.get("totals", {}).get("jobs", 0),
                    "issues": overview.get("totals", {}).get("issues", 0),
                },
            )
        )
    except Exception as exc:
        gates.append(_delivery_gate("overview", "Studio Overview", "blocked", message=str(exc)))

    art_auth = adapter_auth_status("myshell-art")
    gates.append(
        _delivery_gate(
            "myshell-art-auth",
            "MyShell Art Auth",
            str(art_auth.get("status") or "unknown"),
            required=False,
            message=str(art_auth.get("message") or ""),
            evidence=art_auth,
        )
    )

    try:
        sample_jobs = STUDIO_STORE.list_jobs(limit=1)
        gates.append(
            _delivery_gate(
                "job-store",
                "Job Store",
                "ready",
                message="SQLite job store can be queried",
                evidence={"sampleSize": len(sample_jobs), "path": STUDIO_STORE.path},
            )
        )
    except Exception as exc:
        gates.append(_delivery_gate("job-store", "Job Store", "blocked", message=str(exc), evidence={"path": STUDIO_STORE.path}))

    summary = _readiness_summary(gates)
    return {
        "status": _readiness_status(gates),
        "checkedAt": now_iso(),
        "summary": summary,
        "gates": gates,
        "health": health,
    }


def _delivery_audit_artifacts(project_id: str | None, source_segment_id: str | None = None) -> list[dict[str, Any]]:
    context_query = _context_query(project_id, source_segment_id)
    artifacts = [
        _artifact("delivery-audit", "Delivery Audit", "/api/studio/delivery-audit", query=context_query),
        _artifact("generation-smoke", "Live Generation Smoke", "/api/studio/generation-smoke"),
        *_handoff_artifacts(project_id, source_segment_id),
    ]
    if project_id:
        artifacts.extend(
            [
                _artifact("project", "Project", "/api/studio/projects/{project_id}", project_id=project_id),
                _artifact(
                    "delivery-bundle-download",
                    "Downloadable Delivery Bundle",
                    "/api/studio/projects/{project_id}/delivery-bundle",
                    project_id=project_id,
                    query={**_context_query(source_segment_id=source_segment_id), "download": 1},
                    filename=f"myshell-studio-delivery-{project_id}.json",
                ),
            ]
        )
    return artifacts


async def _studio_delivery_audit(
    project_id: str | None = None,
    source_segment_id: str | None = None,
) -> dict[str, Any]:
    project = _get_project(project_id) if project_id else None
    resolved_project_id = project.get("projectId") if project else project_id
    readiness = await _studio_readiness()
    overview = _studio_overview(limit=25)
    dispatch_matrix = _dispatch_matrix(project_id=resolved_project_id, source_segment_id=source_segment_id)
    coverage = _studio_coverage(project_id=resolved_project_id, source_segment_id=source_segment_id)
    delivery_report = _project_delivery_report(project) if project else None
    handoff = (
        await _studio_handoff_snapshot(project_id=resolved_project_id, source_segment_id=source_segment_id)
        if project
        else None
    )
    generation_prerequisites = ((readiness.get("health") or {}).get("components") or {}).get("liveGeneration") or {}
    generation_smoke = _generation_smoke_summary(
        prerequisites=generation_prerequisites,
        latest_job=_latest_generation_smoke_job(),
    )

    readiness_gates = [_requirement_from_gate(gate) for gate in readiness.get("gates") or []]
    pages = list_studio_pages()
    agents = list_studio_agents()
    page_ids = {page["id"] for page in pages}
    agent_ids = {agent["id"] for agent in agents}
    missing_core_pages = sorted(CORE_DELIVERY_PAGE_IDS - page_ids)
    missing_core_agents = sorted(CORE_DELIVERY_AGENT_IDS - agent_ids)
    matrix_summary = dispatch_matrix.get("summary") or {}

    requirements = [
        *readiness_gates,
        _requirement(
            "dispatch-matrix",
            "Dispatch Matrix",
            "ready" if matrix_summary.get("total", 0) >= len(CORE_DELIVERY_PAGE_IDS) else "blocked",
            message=f"{matrix_summary.get('ready', 0)}/{matrix_summary.get('total', 0)} targets ready",
            evidence=matrix_summary,
        ),
        _requirement(
            "live-generation-smoke",
            "Live Generation Smoke",
            "ready" if generation_smoke.get("status") == "done" and (generation_smoke.get("latest") or {}).get("accepted") else str(generation_smoke.get("status") or "needs_verification"),
            message=str(generation_smoke.get("message") or ""),
            evidence={
                "endpoint": "/api/studio/generation-smoke",
                "readyForLiveRun": bool(generation_smoke.get("readyForLiveRun")),
                "latest": generation_smoke.get("latest") or {},
                "missingEnv": (generation_prerequisites.get("missingEnv") or []),
            },
        ),
    ]

    if handoff:
        requirements.append(
            _requirement(
                "handoff-snapshot",
                "Handoff Snapshot",
                _gate_status_from_report(str(handoff.get("status") or "unknown")),
                message=f"{(handoff.get('summary') or {}).get('covered', 0)}/{(handoff.get('summary') or {}).get('pages', 0)} pages covered",
                evidence={
                    "readyForDelivery": bool(handoff.get("readyForDelivery")),
                    "gaps": len(handoff.get("gaps") or []),
                    "actions": len(handoff.get("actions") or []),
                },
            )
        )
        requirements.append(
            _requirement(
                "downloadable-delivery-bundle",
                "Downloadable Delivery Bundle",
                "ready",
                message="Delivery bundle can be downloaded as JSON",
                evidence={
                    "endpoint": "/api/studio/projects/{project_id}/delivery-bundle",
                    "query": {"download": 1},
                    "filename": f"myshell-studio-delivery-{project['projectId']}.json",
                },
            )
        )
    else:
        requirements.append(
            _requirement(
                "handoff-snapshot",
                "Handoff Snapshot",
                "ready",
                required=False,
                message="Pass project_id to include project delivery evidence.",
                evidence={"projectContext": "not_selected"},
            )
        )

    artifacts = _delivery_audit_artifacts(project.get("projectId") if project else None, dispatch_matrix.get("sourceSegmentId"))
    actions = _delivery_audit_actions(requirements, handoff)
    return {
        "status": _audit_status(requirements),
        "checkedAt": now_iso(),
        "projectId": project.get("projectId") if project else None,
        "sourceSegmentId": dispatch_matrix.get("sourceSegmentId"),
        "sourceMediaUrl": dispatch_matrix.get("sourceMediaUrl", ""),
        "summary": {
            "pages": len(pages),
            "agents": len(agents),
            "readyTargets": matrix_summary.get("ready", 0),
            "missingParams": matrix_summary.get("missingParams", 0),
            "missingCorePages": len(missing_core_pages),
            "missingCoreAgents": len(missing_core_agents),
            "readinessGates": (readiness.get("summary") or {}).get("total", 0),
            "readinessReady": (readiness.get("summary") or {}).get("ready", 0),
            "jobs": (overview.get("totals") or {}).get("jobs", 0),
            "artifacts": len(artifacts),
            "actions": len(actions),
        },
        "requirements": requirements,
        "actions": actions,
        "artifacts": artifacts,
        "reports": {
            "health": readiness.get("health") or {},
            "readiness": readiness,
            "overview": overview,
            "dispatchMatrix": dispatch_matrix,
            "coverage": coverage,
            "deliveryReport": delivery_report,
            "handoffSnapshot": handoff,
            "generationSmoke": generation_smoke,
        },
    }


def _operator_action_url(
    endpoint: str,
    target_id: str,
    query: dict[str, Any] | None = None,
    *,
    project_id: str | None = None,
    session_id: str | None = None,
) -> str:
    encoded_target = quote(str(target_id), safe="")
    encoded_project = quote(str(project_id or target_id), safe="")
    encoded_session = quote(str(session_id or target_id), safe="")
    url = (
        endpoint.replace("{job_id}", encoded_target)
        .replace("{project_id}", encoded_project)
        .replace("{session_id}", encoded_session)
    )
    clean_query = {
        key: value
        for key, value in (query or {}).items()
        if value is not None and value != ""
    }
    if clean_query:
        delimiter = "&" if "?" in url else "?"
        url = f"{url}{delimiter}{urlencode(clean_query)}"
    return url


def _materialize_operator_instruction(instruction: dict[str, Any]) -> dict[str, Any]:
    materialized = dict(instruction)
    target_id = str(materialized.get("targetId") or "")
    project_id = str(materialized.get("projectId") or "") or None
    session_id = str(materialized.get("sessionId") or "") or None
    endpoint_query: dict[str, Any] = {}
    raw_query = materialized.get("query")
    if isinstance(raw_query, dict):
        endpoint_query = {
            str(key): value
            for key, value in raw_query.items()
            if value is not None and value != ""
        }
    if materialized.get("endpoint") == "/api/studio/dispatch-preview" and target_id:
        endpoint_query["page_id"] = target_id
        materialized["query"] = endpoint_query
    elif endpoint_query:
        materialized["query"] = endpoint_query

    for field, url_field in (
        ("endpoint", "url"),
        ("retryEndpoint", "retryUrl"),
        ("cancelEndpoint", "cancelUrl"),
    ):
        endpoint = materialized.get(field)
        if endpoint:
            query = endpoint_query if field == "endpoint" else None
            concrete_url = _operator_action_url(
                str(endpoint),
                target_id,
                query,
                project_id=project_id,
                session_id=session_id,
            )
            materialized[field] = concrete_url
            materialized[url_field] = concrete_url
    return materialized


def _manual_action_instruction(action: str, target_id: str, *, session_id: str | None = None) -> dict[str, Any]:
    if action == "restore-auth":
        if target_id in {"live-generation-smoke", "liveGeneration", "credentialSetup"}:
            return {
                "label": "Restore live generation auth",
                "message": "Set DREAMY_TELEGRAM_INIT_DATA and MYSHELL_COOKIES, or create the Cloud Run secrets myshell-dreamy-init-data and myshell-cookies, then redeploy and run the live generation smoke.",
                "env": "DREAMY_TELEGRAM_INIT_DATA,MYSHELL_COOKIES",
                "endpoint": "/api/studio/generation-smoke",
                "targetId": target_id,
            }
        return {
            "label": "Restore MyShell auth",
            "message": "Set MYSHELL_COOKIES or myshell-cookies.json, then restart the backend and refresh readiness.",
            "env": "MYSHELL_COOKIES",
            "targetId": target_id,
        }
    if action == "start-chrome-cdp":
        return {
            "label": "Start Chrome CDP",
            "message": "Start Chrome with remote debugging on port 9222 or set MYSHELL_CDP_URL, then refresh readiness.",
            "command": "Google Chrome --remote-debugging-port=9222",
            "env": "MYSHELL_CDP_URL",
            "targetId": target_id,
        }
    if action == "provide-project-id":
        return {
            "label": "Select a Studio project",
            "message": "Create or restore a Studio project, then rerun the delivery audit with project_id.",
            "endpoint": "/api/studio/projects",
            "targetId": target_id,
        }
    if action == "provide-route-params":
        return {
            "label": "Provide route parameters",
            "message": "Select a source media segment or provide the required route params, then rerun dispatch preview or coverage.",
            "endpoint": "/api/studio/dispatch-preview",
            "targetId": target_id,
        }
    if action == "wait-or-refresh":
        return {
            "label": "Wait or refresh evidence",
            "message": "Wait for adapter evidence, then refresh coverage, handoff snapshot, or the delivery audit.",
            "endpoint": "/api/studio/coverage",
            "targetId": target_id,
        }
    if action == "retry-or-inspect":
        return {
            "label": "Retry or inspect target",
            "message": "Inspect the latest job/evidence for this target, then retry the job or rerun dispatch when appropriate.",
            "endpoint": "/api/studio/jobs/{job_id}",
            "retryEndpoint": "/api/studio/jobs/{job_id}/retry",
            "targetId": target_id,
        }
    if action == "restore-readiness":
        return {
            "label": "Restore dispatch readiness",
            "message": "Inspect the page auth, route params, and dispatch matrix entry, then restore the missing readiness prerequisite.",
            "endpoint": "/api/studio/dispatch-matrix",
            "targetId": target_id,
        }
    if action == "inspect-dispatch-matrix":
        return {
            "label": "Inspect dispatch matrix",
            "message": "Open the dispatch matrix and check auth status, missing route params, executor, and recommended action.",
            "endpoint": "/api/studio/dispatch-matrix",
            "targetId": target_id,
        }
    if action == "inspect-requirement":
        return {
            "label": "Inspect delivery requirement",
            "message": "Inspect the named readiness or audit requirement and resolve the reported gate before retrying handoff.",
            "endpoint": "/api/studio/delivery-audit",
            "targetId": target_id,
        }
    if action == "inspect-gap":
        if session_id:
            return {
                "label": "Inspect dispatch target",
                "message": "Open the dispatch session and review the target evidence before deciding whether to retry, skip, or keep it blocked.",
                "endpoint": "/api/studio/dispatch-sessions/{session_id}",
                "uiUrl": _dispatch_session_ui_url(session_id, target_id),
                "query": {"target_id": target_id},
                "targetId": target_id,
                "sessionId": session_id,
            }
        return {
            "label": "Inspect handoff gap",
            "message": "Inspect the handoff snapshot gap and related coverage evidence before retrying the target.",
            "endpoint": "/api/studio/handoff-snapshot",
            "targetId": target_id,
        }
    if action == "retry-queue":
        if session_id:
            return {
                "label": "Retry dispatch queue",
                "message": "Retry this dispatch session to reopen cancelled or errored targets, then continue from the next pending target.",
                "endpoint": "/api/studio/dispatch-sessions/{session_id}",
                "retryEndpoint": "/api/studio/dispatch-sessions/{session_id}/retry",
                "uiUrl": _dispatch_session_ui_url(session_id, target_id),
                "query": {"target_id": target_id},
                "targetId": target_id,
                "sessionId": session_id,
            }
        return {
            "label": "Retry dispatch queue",
            "message": "Open the related dispatch session and retry cancelled or errored targets.",
            "endpoint": "/api/studio/dispatch-sessions/{session_id}",
            "targetId": target_id,
        }
    if action == "wait-for-adapter":
        return {
            "label": "Wait for adapter",
            "message": "The adapter has not produced accepted evidence yet. Wait, refresh the job queue, or cancel if it is stale.",
            "endpoint": "/api/studio/jobs/{job_id}",
            "cancelEndpoint": "/api/studio/jobs/{job_id}/cancel",
            "targetId": target_id,
        }
    if action == "poll-result":
        return {
            "label": "Poll result",
            "message": "Refresh the job evidence and adapter result until a terminal state or accepted media is available.",
            "endpoint": "/api/studio/jobs/{job_id}/evidence",
            "targetId": target_id,
        }
    if action == "retry-or-cancel":
        return {
            "label": "Retry or cancel job",
            "message": "Retry the job if the adapter can run again, or cancel it to unblock the delivery queue.",
            "retryEndpoint": "/api/studio/jobs/{job_id}/retry",
            "cancelEndpoint": "/api/studio/jobs/{job_id}/cancel",
            "targetId": target_id,
        }
    if action == "inspect-error":
        return {
            "label": "Inspect job error",
            "message": "Open the job evidence trail, review the adapter error, then retry, cancel, or fix the adapter input.",
            "endpoint": "/api/studio/jobs/{job_id}/evidence",
            "targetId": target_id,
        }
    if action == "verify-evidence":
        return {
            "label": "Verify evidence",
            "message": "Confirm the job has accepted fresh media or explicit failure evidence before treating it as deliverable.",
            "endpoint": "/api/studio/jobs/{job_id}/evidence",
            "targetId": target_id,
        }
    return {
        "label": "Inspect Studio action",
        "message": "Inspect the related requirement, dispatch target, or job evidence before retrying.",
        "targetId": target_id,
    }


def _action_with_operator_instruction(action: dict[str, Any]) -> dict[str, Any]:
    action_name = str(action.get("action") or "")
    if action_name not in MANUAL_STUDIO_ACTIONS and action_name != "retry-queue":
        return action

    target_id = str(
        action.get("targetId")
        or action.get("jobId")
        or action.get("segmentId")
        or action.get("pageId")
        or ""
    )
    if not target_id:
        return action

    session_id = str(action.get("sessionId") or "") or None
    next_instruction = _materialize_operator_instruction(
        _manual_action_instruction(action_name, target_id, session_id=session_id)
    )
    enriched = {**action, "next": next_instruction}
    for key in ("url", "retryUrl", "cancelUrl", "uiUrl"):
        if next_instruction.get(key) and not enriched.get(key):
            enriched[key] = next_instruction[key]
    return enriched


async def _resolve_studio_action(payload: dict[str, Any] | None) -> dict[str, Any]:
    body = payload or {}
    action = str(body.get("action") or "").strip()
    target_id = str(body.get("target_id") or body.get("targetId") or "").strip()
    session_id = str(body.get("session_id") or body.get("sessionId") or "").strip()
    project_id = body.get("project_id") or body.get("projectId")
    source_segment_id = body.get("source_segment_id") or body.get("sourceSegmentId")
    if not action:
        raise HTTPException(status_code=400, detail="action is required")
    if not target_id:
        raise HTTPException(status_code=400, detail="target_id is required")

    if action == "verify-ready":
        result = _verify_studio_coverage(
            project_id=project_id,
            source_segment_id=source_segment_id,
            page_ids=[target_id],
            limit=1,
        )
        audit = await _studio_delivery_audit(
            project_id=result.get("projectId") or project_id,
            source_segment_id=result.get("sourceSegmentId") or source_segment_id,
        )
        created_count = int(result.get("createdCount") or 0)
        return {
            "status": "executed" if created_count else "skipped",
            "checkedAt": now_iso(),
            "action": action,
            "targetId": target_id,
            "projectId": result.get("projectId") or project_id,
            "sourceSegmentId": result.get("sourceSegmentId") or source_segment_id,
            "resultType": "coverage-verify",
            "message": f"Verified {created_count} ready target(s).",
            "result": result,
            "audit": audit,
        }

    if action == "run-target":
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required for run-target")
        result = _run_dispatch_session_target(session_id, target_id)
        resolved_session = result.get("session") if isinstance(result.get("session"), dict) else {}
        resolved_project_id = resolved_session.get("projectId") or project_id
        resolved_source_segment_id = resolved_session.get("sourceSegmentId") or source_segment_id
        audit = await _studio_delivery_audit(
            project_id=resolved_project_id,
            source_segment_id=resolved_source_segment_id,
        )
        return {
            "status": "executed",
            "checkedAt": now_iso(),
            "action": action,
            "targetId": target_id,
            "sessionId": session_id,
            "projectId": resolved_project_id,
            "sourceSegmentId": resolved_source_segment_id,
            "resultType": "dispatch-target-run",
            "message": f"Ran dispatch target {target_id}.",
            "result": result,
            "audit": audit,
        }

    if action == "retry-queue":
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id is required for retry-queue")
        session = _retry_dispatch_session(session_id)
        resolved_project_id = session.get("projectId") or project_id
        resolved_source_segment_id = session.get("sourceSegmentId") or source_segment_id
        audit = await _studio_delivery_audit(
            project_id=resolved_project_id,
            source_segment_id=resolved_source_segment_id,
        )
        pending = int((session.get("summary") or {}).get("pending") or 0)
        return {
            "status": "executed",
            "checkedAt": now_iso(),
            "action": action,
            "targetId": target_id,
            "sessionId": session_id,
            "projectId": resolved_project_id,
            "sourceSegmentId": resolved_source_segment_id,
            "resultType": "dispatch-session-retry",
            "message": f"Retried dispatch session {session_id}; {pending} target(s) pending.",
            "result": {"session": session},
            "audit": audit,
        }

    if action in MANUAL_STUDIO_ACTIONS:
        audit = await _studio_delivery_audit(project_id=project_id, source_segment_id=source_segment_id)
        return {
            "status": "manual_required",
            "checkedAt": now_iso(),
            "action": action,
            "targetId": target_id,
            "sessionId": session_id or None,
            "projectId": project_id,
            "sourceSegmentId": source_segment_id,
            "resultType": "operator-instruction",
            "message": "Manual operator action is required.",
            "next": _materialize_operator_instruction(
                _manual_action_instruction(action, target_id, session_id=session_id or None)
            ),
            "audit": audit,
        }

    raise HTTPException(status_code=400, detail=f"Unsupported Studio action: {action}")


async def _resolve_studio_actions_batch(payload: dict[str, Any] | None) -> dict[str, Any]:
    body = payload or {}
    project_id = body.get("project_id") or body.get("projectId")
    source_segment_id = body.get("source_segment_id") or body.get("sourceSegmentId")
    requested_actions = body.get("actions")
    if requested_actions is None:
        audit = await _studio_delivery_audit(project_id=project_id, source_segment_id=source_segment_id)
        requested_actions = audit.get("actions") or []
    if not isinstance(requested_actions, list):
        raise HTTPException(status_code=400, detail="actions must be a list")

    normalized_actions: list[dict[str, Any]] = []
    for item in requested_actions:
        if not isinstance(item, dict):
            raise HTTPException(status_code=400, detail="Each action must be an object")
        action = str(item.get("action") or "").strip()
        target_id = str(item.get("target_id") or item.get("targetId") or "").strip()
        session_id = str(item.get("session_id") or item.get("sessionId") or "").strip()
        if not action or not target_id:
            raise HTTPException(status_code=400, detail="Each action requires action and target_id")
        normalized_actions.append({"action": action, "targetId": target_id, "sessionId": session_id, "raw": item})

    verify_page_ids = []
    run_target_actions: list[dict[str, str]] = []
    retry_queue_actions: list[dict[str, str]] = []
    manual_actions: list[dict[str, Any]] = []
    skipped_actions: list[dict[str, Any]] = []
    for item in normalized_actions:
        action = item["action"]
        target_id = item["targetId"]
        session_id = item.get("sessionId") or ""
        if action == "verify-ready":
            verify_page_ids.append(target_id)
        elif action == "run-target":
            if session_id:
                run_target_actions.append({"targetId": target_id, "sessionId": session_id})
            else:
                skipped_actions.append(
                    {
                        "status": "skipped",
                        "action": action,
                        "targetId": target_id,
                        "resultType": "dispatch-target-run",
                        "reason": "missing_session_id",
                        "message": "run-target requires session_id.",
                    }
                )
        elif action == "retry-queue":
            if session_id:
                retry_queue_actions.append({"targetId": target_id, "sessionId": session_id})
            else:
                skipped_actions.append(
                    {
                        "status": "skipped",
                        "action": action,
                        "targetId": target_id,
                        "resultType": "dispatch-session-retry",
                        "reason": "missing_session_id",
                        "message": "retry-queue requires session_id.",
                    }
                )
        elif action in MANUAL_STUDIO_ACTIONS:
            manual_actions.append(
                {
                    "status": "manual_required",
                    "action": action,
                    "targetId": target_id,
                    "sessionId": session_id or None,
                    "resultType": "operator-instruction",
                    "message": "Manual operator action is required.",
                    "next": _materialize_operator_instruction(
                        _manual_action_instruction(action, target_id, session_id=session_id or None)
                    ),
                }
            )
        else:
            skipped_actions.append(
                {
                    "status": "skipped",
                    "action": action,
                    "targetId": target_id,
                    "resultType": "unsupported",
                    "message": f"Unsupported Studio action: {action}",
                }
            )

    coverage_result: dict[str, Any] | None = None
    executed_actions: list[dict[str, Any]] = []
    if verify_page_ids:
        coverage_result = _verify_studio_coverage(
            project_id=project_id,
            source_segment_id=source_segment_id,
            page_ids=verify_page_ids,
            limit=len(verify_page_ids),
        )
        jobs_by_page = {job.get("pageId"): job for job in coverage_result.get("jobs") or []}
        skipped_by_page = {page.get("pageId"): page for page in coverage_result.get("skippedPages") or []}
        for page_id in verify_page_ids:
            if page_id in jobs_by_page:
                executed_actions.append(
                    {
                        "status": "executed",
                        "action": "verify-ready",
                        "targetId": page_id,
                        "resultType": "coverage-verify",
                        "jobId": jobs_by_page[page_id].get("jobId"),
                        "message": f"Verified {page_id}.",
                    }
                )
            else:
                skipped = skipped_by_page.get(page_id) or {}
                skipped_actions.append(
                    {
                        "status": "skipped",
                        "action": "verify-ready",
                        "targetId": page_id,
                        "resultType": "coverage-verify",
                        "reason": skipped.get("reason") or "not_verified",
                        "message": skipped.get("message") or "No verification job was created.",
                    }
                )

    resolved_project_id = (coverage_result or {}).get("projectId") or project_id
    resolved_source_segment_id = (coverage_result or {}).get("sourceSegmentId") or source_segment_id
    run_target_job_count = 0
    for item in run_target_actions:
        target_id = item["targetId"]
        session_id = item["sessionId"]
        try:
            result = _run_dispatch_session_target(session_id, target_id)
        except HTTPException as exc:
            skipped_actions.append(
                {
                    "status": "skipped",
                    "action": "run-target",
                    "targetId": target_id,
                    "sessionId": session_id,
                    "resultType": "dispatch-target-run",
                    "reason": f"http_{exc.status_code}",
                    "message": str(exc.detail),
                }
            )
            continue
        result_session = result.get("session") if isinstance(result.get("session"), dict) else {}
        resolved_project_id = result_session.get("projectId") or resolved_project_id
        resolved_source_segment_id = result_session.get("sourceSegmentId") or resolved_source_segment_id
        if result.get("job"):
            run_target_job_count += 1
        executed_actions.append(
            {
                "status": "executed",
                "action": "run-target",
                "targetId": target_id,
                "sessionId": session_id,
                "resultType": "dispatch-target-run",
                "jobId": (result.get("job") or {}).get("jobId"),
                "message": f"Ran dispatch target {target_id}.",
                "result": result,
            }
        )

    for item in retry_queue_actions:
        target_id = item["targetId"]
        session_id = item["sessionId"]
        try:
            session = _retry_dispatch_session(session_id)
        except HTTPException as exc:
            skipped_actions.append(
                {
                    "status": "skipped",
                    "action": "retry-queue",
                    "targetId": target_id,
                    "sessionId": session_id,
                    "resultType": "dispatch-session-retry",
                    "reason": f"http_{exc.status_code}",
                    "message": str(exc.detail),
                }
            )
            continue
        resolved_project_id = session.get("projectId") or resolved_project_id
        resolved_source_segment_id = session.get("sourceSegmentId") or resolved_source_segment_id
        pending = int((session.get("summary") or {}).get("pending") or 0)
        executed_actions.append(
            {
                "status": "executed",
                "action": "retry-queue",
                "targetId": target_id,
                "sessionId": session_id,
                "resultType": "dispatch-session-retry",
                "message": f"Retried dispatch session {session_id}; {pending} target(s) pending.",
                "result": {"session": session},
            }
        )

    audit = await _studio_delivery_audit(project_id=resolved_project_id, source_segment_id=resolved_source_segment_id)
    status = "executed"
    if manual_actions and executed_actions:
        status = "executed_with_manual"
    elif manual_actions and not executed_actions:
        status = "manual_required"
    elif skipped_actions and not executed_actions:
        status = "skipped"
    elif skipped_actions:
        status = "executed_with_skips"

    return {
        "status": status,
        "checkedAt": now_iso(),
        "projectId": resolved_project_id,
        "sourceSegmentId": resolved_source_segment_id,
        "summary": {
            "requested": len(normalized_actions),
            "executed": len(executed_actions),
            "manualRequired": len(manual_actions),
            "skipped": len(skipped_actions),
            "createdJobs": int((coverage_result or {}).get("createdCount") or 0) + run_target_job_count,
        },
        "executedActions": executed_actions,
        "manualActions": manual_actions,
        "skippedActions": skipped_actions,
        "result": coverage_result,
        "audit": audit,
    }


def _cancel_job_record(job: dict[str, Any]) -> tuple[dict[str, Any], StudioProject | None]:
    updated_job = _update_job(
        job,
        status="cancelled",
        evidence=_evidence("cancelled", job.get("pageId", "studio"), message="Cancelled by Studio operator."),
    )
    project = _get_project(updated_job["projectId"])
    if project:
        segment = _find_segment(project, updated_job["segmentId"])
        if segment:
            segment["status"] = "cancelled"
            segment["evidence"] = updated_job["evidence"]
            segment["updatedAt"] = now_iso()
        project["updatedAt"] = now_iso()
        _sync_project_jobs(project)
    return updated_job, project


def _retry_job_record(job: dict[str, Any]) -> tuple[dict[str, Any], StudioProject | None, dict[str, Any] | None]:
    updated_job = _update_job(
        job,
        status="queued",
        attempt=int(job.get("attempt") or 1) + 1,
        evidence=_evidence("queued", job.get("pageId", "studio"), message="Retry queued; waiting for adapter execution."),
    )
    project = _get_project(updated_job["projectId"])
    if project:
        segment = _find_segment(project, updated_job["segmentId"])
        if segment:
            segment["status"] = "queued"
            segment["evidence"] = updated_job["evidence"]
            segment["updatedAt"] = now_iso()
        project["updatedAt"] = now_iso()
        execution_request = _build_execution_request(project, updated_job)
        _sync_project_jobs(project)
    else:
        execution_request = None
    return updated_job, project, execution_request


async def _dispatch_preview(
    *,
    message: str,
    action: str,
    page_id: str,
    agent_id: str | None = None,
    project_id: str | None = None,
    source_segment_id: str | None = None,
    has_image: bool = False,
    bot_id: str | None = None,
    bot_slug: str | None = None,
    bot_name: str | None = None,
    bot_type: str | None = None,
    article_id: str | None = None,
) -> dict[str, Any]:
    normalized_action = _normalize_action(action)
    preferred_page = get_page(page_id)
    prompt = (message or "").strip() or (
        f"Open {preferred_page['name']}"
        if preferred_page.get("executor") == "navigation"
        else {
            "generate": "Create a new Dreamy media segment.",
            "extend": "Extend the selected video with a natural next shot.",
            "restyle": "Restyle the selected segment while keeping the subject consistent.",
            "retry-agent": "Try another agent for the selected segment.",
        }[normalized_action]
    )

    project = _get_project(project_id) if project_id else None
    source_segment = _resolve_source_segment(project, source_segment_id)
    resolved_source_segment_id = source_segment.get("id") if source_segment else source_segment_id
    route = (
        _dreamy_bot_route(
            bot_id=bot_id,
            bot_slug=bot_slug,
            bot_name=bot_name,
            bot_type=bot_type,
            article_id=article_id,
            message=prompt,
        )
        if page_id == "dreamy-miniapp" and (bot_slug or bot_id)
        else None
    )
    if route is None:
        route = await choose_route(prompt, has_image, normalized_action, source_segment)
    page = page_for_dispatch(route["bot"], page_id, prompt)
    route["action"] = normalized_action
    route["sourceSegmentId"] = resolved_source_segment_id
    route["sourceSummary"] = f"Using segment {resolved_source_segment_id}" if resolved_source_segment_id else "Starting from prompt"
    route["page"] = page
    route["api"] = page["id"]
    route["executor"] = page["executor"]
    route["agentId"] = _agent_id_for_dispatch(page, agent_id)
    contract = _navigation_contract(page, route, source_segment)
    runtime_page = _page_with_runtime_status(page)
    navigation_path = contract.get("navigationPath", "")
    return {
        "page": runtime_page,
        "route": route,
        "executor": page["executor"],
        "agentId": route["agentId"],
        "authStatus": runtime_page["authStatus"],
        "dispatchReady": runtime_page["dispatchReady"],
        "dispatchStatus": runtime_page["dispatchStatus"],
        "dispatchMessage": runtime_page["dispatchMessage"],
        "clientAction": contract.get("clientAction"),
        "navigationPath": navigation_path,
        "studioReturnPath": contract.get("studioReturnPath"),
        "routeParams": page.get("routeParams") or [],
        "missingRouteParams": _missing_route_params(page, navigation_path),
        "prompt": route.get("optimizedPrompt") or prompt,
    }


def now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def make_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _normalize_mode(mode: str) -> str:
    return mode if mode in VALID_MODES else "player"


def _normalize_action(action: str) -> str:
    return action if action in VALID_ACTIONS else "generate"


def _normalize_status(status: str | None) -> str:
    if status in {"completed", "success"}:
        return "done"
    return status if status in VALID_STATUSES else "running"


def _save_project(project: StudioProject) -> None:
    PROJECTS[project["projectId"]] = project
    STUDIO_STORE.save_project(project)


def _get_project(project_id: str) -> Optional[StudioProject]:
    if project_id in PROJECTS:
        return PROJECTS[project_id]
    project = STUDIO_STORE.get_project(project_id)
    if project:
        PROJECTS[project_id] = project
    return project


def _segment_type_for_bot(bot: dict[str, Any]) -> str:
    return "video" if bot.get("type") == "image-to-video" else "image"


def _project(project_id: Optional[str] = None, mode: str = "player") -> StudioProject:
    if project_id and project_id in PROJECTS:
        project = PROJECTS[project_id]
        project["mode"] = _normalize_mode(mode or project.get("mode", "player"))
        project["updatedAt"] = now_iso()
        _save_project(project)
        return project

    if project_id:
        stored = STUDIO_STORE.get_project(project_id)
        if stored:
            stored["mode"] = _normalize_mode(mode or stored.get("mode", "player"))
            stored["updatedAt"] = now_iso()
            stored["jobs"] = STUDIO_STORE.list_jobs(project_id)
            _save_project(stored)
            return stored

    new_id = project_id or make_id("project")
    project = {
        "projectId": new_id,
        "conversationId": make_id("conversation"),
        "mode": _normalize_mode(mode),
        "messages": [],
        "segments": [],
        "selectedSegmentId": None,
        "agentGraph": default_agent_graph(),
        "jobs": [],
        "updatedAt": now_iso(),
    }
    _save_project(project)
    return project


def _verified_dreamy_workshop_project() -> StudioProject:
    existing = _get_project(VERIFIED_DREAMY_WORKSHOP_PROJECT_ID)
    if existing and len(existing.get("segments") or []) >= len(VERIFIED_DREAMY_WORKSHOP_SEGMENTS):
        existing["jobs"] = STUDIO_STORE.list_jobs(existing["projectId"])
        return existing

    checked_at = now_iso()
    project = {
        "projectId": VERIFIED_DREAMY_WORKSHOP_PROJECT_ID,
        "conversationId": "conversation_verified_workshop",
        "mode": "player",
        "messages": [
            {
                "id": "verified-workshop-user",
                "role": "user",
                "content": "Stage two completed Dreamy workshop bot results into a timeline.",
                "createdAt": "2026-06-03T09:10:00Z",
                "action": "generate",
            },
            {
                "id": "verified-workshop-assistant",
                "role": "assistant",
                "content": "Two real Dreamy workshop outputs are staged. Add another segment or export the timeline.",
                "createdAt": checked_at,
                "action": "extend",
                "segmentId": VERIFIED_DREAMY_WORKSHOP_SEGMENTS[-1]["id"],
            },
        ],
        "segments": json.loads(json.dumps(VERIFIED_DREAMY_WORKSHOP_SEGMENTS)),
        "selectedSegmentId": VERIFIED_DREAMY_WORKSHOP_SEGMENTS[-1]["id"],
        "agentGraph": [
            {"id": "intent-router", "label": "Intent Router", "status": "done", "detail": "Verified workshop route"},
            {"id": "dreamy-bot-1", "label": "3D Anime Porn", "status": "done", "detail": "Real media accepted"},
            {"id": "dreamy-bot-2", "label": "3D Futa Porn", "status": "done", "detail": "Second segment accepted"},
            {"id": "timeline", "label": "Timeline", "status": "done", "detail": "Two clips ready for export"},
        ],
        "jobs": [],
        "timelineExports": [],
        "updatedAt": checked_at,
    }
    _save_project(project)
    return project


def default_agent_graph() -> list[dict[str, Any]]:
    return [
        {
            "id": "intent-router",
            "label": "Intent Router",
            "status": "idle",
            "detail": "Natural language to creative action",
        },
        {
            "id": "asset-planner",
            "label": "Asset Planner",
            "status": "idle",
            "detail": "Selects source segment and media shape",
        },
        {
            "id": "dreamy-executor",
            "label": "Page Executor",
            "status": "idle",
            "detail": "Runs miniapp or MyShell Art generation",
        },
        {
            "id": "timeline",
            "label": "Timeline",
            "status": "idle",
            "detail": "Appends output as a temporary segment",
        },
    ]


def _set_graph_status(
    project: StudioProject,
    route: dict[str, Any],
    segment: Optional[StudioSegment] = None,
) -> list[dict[str, Any]]:
    graph = default_agent_graph()
    graph[0]["status"] = "done"
    graph[0]["detail"] = route.get("analysis") or "Intent understood"
    graph[1]["status"] = "done"
    graph[1]["detail"] = route.get("sourceSummary") or "Using current prompt"
    graph[2]["status"] = "running" if segment and segment.get("status") in {"queued", "running"} else "done"
    graph[2]["detail"] = f"{route['bot']['name']} via {route['executor']}"
    graph[3]["status"] = "queued" if segment and segment.get("status") in {"queued", "running"} else "idle"
    graph[3]["detail"] = "Segment queued in project timeline" if segment else "Waiting for output"
    project["agentGraph"] = graph
    return graph


def _normalize_dreamy_bot_type(bot_type: str | None) -> str:
    normalized = (bot_type or "").strip().lower()
    if normalized in {"video", "image-to-video", "text-to-video"}:
        return "image-to-video"
    if normalized in {"image", "text-to-image", "image-to-image"}:
        return "text-to-image"
    return "text-to-image"


def _dreamy_catalog_type_from_media(item: dict[str, Any]) -> str:
    title = str(item.get("title") or item.get("botName") or "").lower()
    media_values = [
        str(item.get("templateUrl") or ""),
        str(item.get("templatePosterUrl") or ""),
        str(item.get("imageUrl") or ""),
        str(item.get("imagePosterUrl") or ""),
    ]
    if any(value.lower().endswith(".mp4") for value in media_values):
        return "image-to-video"
    if any(word in title for word in ("video", "dance", "motion", "animate")):
        return "image-to-video"
    return "text-to-image"


def _slug_from_dreamy_goto_link(goto_link: str) -> str:
    if not goto_link:
        return ""
    parsed = urlsplit(goto_link)
    query_slug = dict(parse_qsl(parsed.query)).get("slug_id")
    if query_slug:
        return query_slug
    path = parsed.path or goto_link
    return path.rstrip("/").split("/")[-1]


def _dreamy_bot_route(
    *,
    bot_id: str | None = None,
    bot_slug: str | None,
    bot_name: str | None = None,
    bot_type: str | None = None,
    article_id: str | None = None,
    message: str = "",
) -> dict[str, Any] | None:
    explicit_bot_id = (bot_id or "").strip()
    slug = (bot_slug or explicit_bot_id).strip()
    if not slug:
        return None
    seed = get_dreamy_bot_by_slug(slug) or {}
    resolved_type = _normalize_dreamy_bot_type(bot_type or seed.get("type"))
    name = (bot_name or seed.get("name") or explicit_bot_id or slug).strip()
    resolved_article_id = (article_id or slug).strip()
    description = str(seed.get("desc") or "Selected from the Dreamy miniapp bot catalog.")
    return {
        "intent": "image-to-video" if resolved_type == "image-to-video" else "text-to-image",
        "analysis": "Selected explicitly from the Dreamy Studio bot list.",
        "optimizedPrompt": message or "Create a polished Dreamy media segment.",
        "reason": "Pinned by the left-side Dreamy bot selection.",
        "bot": {
            "id": explicit_bot_id,
            "slug": slug,
            "name": name,
            "type": resolved_type,
            "articleId": resolved_article_id,
            "rating": seed.get("rating", 4.6),
            "description": description,
            "pageUrl": f"/bot?slug_id={quote(slug)}",
        },
        "executor": "client",
    }


def _manual_bot_sequence_items(bot_sequence: str | None, default_action: str) -> list[dict[str, str]]:
    raw = (bot_sequence or "").strip()
    if not raw:
        return []
    parsed: Any
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        parsed = [item for item in re.split(r"[\s,]+", raw) if item]
    if isinstance(parsed, dict):
        parsed = parsed.get("bots") or parsed.get("sequence") or parsed.get("items") or []
    if not isinstance(parsed, list):
        return []

    items: list[dict[str, str]] = []
    for index, item in enumerate(parsed[:12]):
        if isinstance(item, str):
            item_data: dict[str, Any] = {"botId": item, "botSlug": item}
        elif isinstance(item, dict):
            item_data = item
        else:
            continue
        bot_id = str(item_data.get("botId") or item_data.get("bot_id") or item_data.get("id") or "").strip()
        bot_slug = str(item_data.get("botSlug") or item_data.get("bot_slug") or item_data.get("slug") or bot_id).strip()
        if not bot_id and not bot_slug:
            continue
        bot_name = str(
            item_data.get("botName")
            or item_data.get("bot_name")
            or item_data.get("name")
            or bot_slug
            or bot_id
        ).strip()
        bot_type = str(item_data.get("botType") or item_data.get("bot_type") or item_data.get("type") or "").strip()
        article_id = str(
            item_data.get("articleId")
            or item_data.get("article_id")
            or item_data.get("article")
            or bot_slug
            or bot_id
        ).strip()
        action = _normalize_action(str(item_data.get("action") or ("extend" if index else default_action)))
        prompt = str(item_data.get("prompt") or item_data.get("message") or "").strip()
        items.append(
            {
                "botId": bot_id,
                "botSlug": bot_slug,
                "botName": bot_name,
                "botType": bot_type,
                "articleId": article_id,
                "action": action,
                "prompt": prompt,
            }
        )
    return items


def _keyword_route(message: str, has_image: bool, action: str) -> dict[str, Any]:
    normalized = (message or "").lower()
    wants_video = action == "extend" or any(
        word in normalized for word in ("video", "animate", "motion", "movie", "clip", "extend")
    )
    wants_style = action == "restyle" or any(
        word in normalized for word in ("style", "restyle", "anime", "pixel", "sketch", "neon", "cyber")
    )

    best = None
    best_score = -1.0
    for bot in MYSHELL_BOTS:
        score = float(bot.get("rating", 4.0))
        if wants_video and bot.get("type") == "image-to-video":
            score += 8
        if wants_style and bot.get("type") == "image-to-image":
            score += 4
        if not has_image and bot.get("type") == "text-to-image":
            score += 3
        if has_image and bot.get("type") in {"image-to-image", "image-to-video"}:
            score += 3
        for keyword in bot.get("keywords", []):
            if str(keyword).lower() in normalized:
                score += 2
        if score > best_score:
            best = bot
            best_score = score

    if not best:
        best = get_bot_by_slug("seedream-multi-chart") or MYSHELL_BOTS[0]

    return {
        "intent": "image-to-video" if best.get("type") == "image-to-video" else best.get("type", "image-to-image"),
        "analysis": "Matched locally from prompt, source media, and action.",
        "optimizedPrompt": message or "Create a polished Dreamy media segment.",
        "reason": "Best local catalog match for the requested next step.",
        "bot": {
            "slug": best["slug"],
            "name": best["name"],
            "type": best["type"],
            "rating": best.get("rating", 4.5),
            "description": best.get("desc", ""),
            "pageUrl": f"https://art.myshell.ai/creative/{best['slug']}",
        },
        "executor": "client",
    }


async def choose_route(message: str, has_image: bool, action: str, source_segment: Optional[StudioSegment]) -> dict[str, Any]:
    use_llm = os.environ.get("STUDIO_ROUTER_MODE") == "gemini" and os.environ.get("GEMINI_API_KEY")
    if use_llm and understand_intent:
        try:
            intent = await understand_intent(message, has_image or bool(source_segment))
            bot_slug = intent.get("selected_bot_slug") or "seedream-multi-chart"
            bot = get_bot_by_slug(bot_slug) or get_bot_by_slug("seedream-multi-chart") or MYSHELL_BOTS[0]
            return {
                "intent": intent.get("intent", bot.get("type", "image-to-image")),
                "analysis": intent.get("analysis", "Intent understood."),
                "optimizedPrompt": intent.get("optimized_prompt") or message,
                "reason": intent.get("reason", "Selected by Studio router."),
                "bot": {
                    "slug": bot["slug"],
                    "name": bot["name"],
                    "type": bot["type"],
                    "rating": bot.get("rating", 4.5),
                    "description": bot.get("desc", ""),
                    "pageUrl": f"https://art.myshell.ai/creative/{bot['slug']}",
                },
                "executor": "client",
            }
        except Exception:
            pass
    return _keyword_route(message, has_image or bool(source_segment), action)


def _find_segment(project: StudioProject, segment_id: Optional[str]) -> Optional[StudioSegment]:
    if not segment_id:
        return None
    for segment in project.get("segments", []):
        if segment.get("id") == segment_id:
            return segment
    return None


def _latest_accepted_media_segment(project: StudioProject | None) -> Optional[StudioSegment]:
    if not project:
        return None
    for segment in reversed(project.get("segments", [])):
        if _accepted_source_media_url(segment):
            return segment
    return None


def _resolve_source_segment(project: StudioProject | None, segment_id: Optional[str]) -> Optional[StudioSegment]:
    if not project:
        return None
    requested = _find_segment(project, segment_id)
    if _accepted_source_media_url(requested):
        return requested
    return _latest_accepted_media_segment(project)


def _append_message(project: StudioProject, role: str, content: str, **extra: Any) -> dict[str, Any]:
    message = {
        "id": make_id("message"),
        "role": role,
        "content": content,
        "createdAt": now_iso(),
        **extra,
    }
    project["messages"].append(message)
    project["updatedAt"] = now_iso()
    _save_project(project)
    return message


def _evidence(
    status: str,
    source: str,
    *,
    accepted: bool = False,
    message: str = "",
    media_url: str = "",
    task_id: str = "",
) -> dict[str, Any]:
    return {
        "status": status,
        "source": source,
        "accepted": accepted,
        "mediaUrl": media_url,
        "taskId": task_id,
        "message": message,
        "checkedAt": now_iso(),
    }


def _exception_message(exc: Exception) -> str:
    detail = str(exc)
    return f"{type(exc).__name__}: {detail}" if detail else type(exc).__name__


def _sync_project_jobs(project: StudioProject) -> None:
    segment_order = {str(segment.get("id") or ""): index for index, segment in enumerate(project.get("segments", []))}
    jobs = [_job_with_evidence(job) for job in STUDIO_STORE.list_jobs(project["projectId"])]
    jobs.sort(key=lambda job: segment_order.get(str(job.get("segmentId") or ""), len(segment_order)))
    project["jobs"] = jobs
    _save_project(project)


def _job_with_evidence(job: dict[str, Any] | None) -> dict[str, Any] | None:
    if not job:
        return None
    enriched = dict(job)
    enriched["evidenceTrail"] = STUDIO_STORE.list_evidence(job_id=job["jobId"])
    return enriched


def _delivery_action_for_status(status: str, evidence: dict[str, Any]) -> dict[str, Any] | None:
    if status in {"draft", "queued"}:
        return {
            "action": "wait-for-adapter",
            "status": status,
            "message": evidence.get("message") or "Adapter output has not been accepted yet.",
        }
    if status == "running":
        return {
            "action": "poll-result",
            "status": status,
            "message": evidence.get("message") or "Job is still running; refresh or wait for result evidence.",
        }
    if status == "auth_missing":
        return {
            "action": "restore-auth",
            "status": status,
            "message": evidence.get("message") or "Authentication is missing for this adapter.",
        }
    if status == "timeout":
        return {
            "action": "retry-or-cancel",
            "status": status,
            "message": evidence.get("message") or "Adapter timed out before returning accepted evidence.",
        }
    if status == "error":
        return {
            "action": "inspect-error",
            "status": status,
            "message": evidence.get("message") or "Adapter reported an error.",
        }
    if status == "done" and not evidence.get("accepted"):
        return {
            "action": "verify-evidence",
            "status": status,
            "message": evidence.get("message") or "Done status needs accepted media evidence.",
        }
    return None


def _project_delivery_report(project: StudioProject) -> dict[str, Any]:
    _sync_project_jobs(project)
    jobs = [_job_with_evidence(job) for job in STUDIO_STORE.list_jobs(project["projectId"])]
    jobs_by_id = {job["jobId"]: job for job in jobs if job}
    jobs_by_segment: dict[str, dict[str, Any]] = {}
    for job in jobs:
        if job and job.get("segmentId") and job.get("segmentId") not in jobs_by_segment:
            jobs_by_segment[str(job["segmentId"])] = job

    segment_reports: list[dict[str, Any]] = []
    unresolved_actions: list[dict[str, Any]] = []
    accepted_evidence = 0
    pending_evidence = 0
    issue_count = 0

    for segment in project.get("segments", []):
        job = jobs_by_id.get(segment.get("jobId")) or jobs_by_segment.get(segment.get("id")) or {}
        evidence = segment.get("evidence") or job.get("evidence") or {}
        evidence_trail = job.get("evidenceTrail") or []
        status = str(segment.get("status") or job.get("status") or "draft")
        if evidence.get("accepted"):
            accepted_evidence += 1
        if status in PENDING_DELIVERY_STATUSES or (status == "done" and not evidence.get("accepted")):
            pending_evidence += 1
        if status in ISSUE_DELIVERY_STATUSES:
            issue_count += 1

        action = _delivery_action_for_status(status, evidence)
        if action:
            unresolved_actions.append(
                {
                    **action,
                    "segmentId": segment.get("id"),
                    "jobId": job.get("jobId") or segment.get("jobId") or "",
                    "pageId": job.get("pageId") or job.get("api") or "",
                    "botName": segment.get("botName") or job.get("botName") or "",
                }
            )

        segment_reports.append(
            {
                "segmentId": segment.get("id"),
                "jobId": job.get("jobId") or segment.get("jobId") or "",
                "pageId": job.get("pageId") or job.get("api") or "",
                "pageName": job.get("pageName") or "",
                "agentId": job.get("agentId") or "",
                "status": status,
                "botName": segment.get("botName") or job.get("botName") or "",
                "mediaUrl": segment.get("url") or job.get("mediaUrl") or "",
                "posterUrl": segment.get("posterUrl") or job.get("posterUrl") or "",
                "taskId": segment.get("taskId") or job.get("taskId") or "",
                "authStatus": segment.get("authStatus") or job.get("authStatus") or {},
                "evidence": evidence,
                "evidenceTrail": evidence_trail,
                "updatedAt": segment.get("updatedAt") or job.get("updatedAt") or "",
            }
        )

    status_counts = _status_counts([job for job in jobs if job])
    ready_for_handoff = bool(jobs) and not unresolved_actions and accepted_evidence > 0 and issue_count == 0
    handoff_status = "ready" if ready_for_handoff else "needs_attention" if issue_count else "in_progress"

    return {
        "projectId": project["projectId"],
        "conversationId": project.get("conversationId", ""),
        "checkedAt": now_iso(),
        "handoffStatus": handoff_status,
        "readyForHandoff": ready_for_handoff,
        "summary": {
            "totalSegments": len(project.get("segments", [])),
            "totalJobs": len(jobs),
            "acceptedEvidence": accepted_evidence,
            "pendingEvidence": pending_evidence,
            "issueCount": issue_count,
            "unresolvedActionCount": len(unresolved_actions),
        },
        "statusCounts": status_counts,
        "segments": segment_reports,
        "jobs": jobs,
        "unresolvedActions": unresolved_actions,
    }


async def _project_delivery_bundle(
    project: StudioProject,
    source_segment_id: str | None = None,
) -> dict[str, Any]:
    _sync_project_jobs(project)
    project_id = project["projectId"]
    delivery_report = _project_delivery_report(project)
    coverage = _studio_coverage(project_id=project_id, source_segment_id=source_segment_id)
    handoff = await _studio_handoff_snapshot(project_id=project_id, source_segment_id=source_segment_id)
    dispatch_sessions = [
        _dispatch_session_view(session)
        for session in STUDIO_STORE.list_dispatch_sessions(project_id=project_id, limit=50)
    ]
    jobs = [_job_with_evidence(job) for job in STUDIO_STORE.list_jobs(project_id=project_id, limit=500)]
    accepted_jobs = [job for job in jobs if job and (job.get("evidence") or {}).get("accepted")]

    all_targets = [target for session in dispatch_sessions for target in session.get("targets", [])]
    batch_skipped_targets = [target for session in dispatch_sessions for target in session.get("skippedTargets", [])]
    operator_skipped_targets = [
        {
            **target,
            "reason": target.get("reason") or "operator_skipped",
            "message": target.get("message") or (target.get("evidence") or {}).get("reason") or "Operator skipped this target.",
        }
        for target in all_targets
        if target.get("status") == "skipped"
    ]
    skipped_targets = [*batch_skipped_targets, *operator_skipped_targets]
    remaining_targets = [target for target in all_targets if target.get("status", "pending") in {"pending", "visited"}]
    error_targets = [
        {
            **target,
            "message": target.get("message") or (target.get("evidence") or {}).get("message") or "Target needs operator review.",
        }
        for target in all_targets
        if target.get("status") == "error"
    ]
    cancelled_targets = [
        {
            **target,
            "message": target.get("message") or (target.get("evidence") or {}).get("message") or "Target was cancelled before completion.",
        }
        for target in all_targets
        if target.get("status") == "cancelled"
    ]
    target_status_counts = {
        "pending": sum(1 for target in all_targets if target.get("status", "pending") == "pending"),
        "visited": sum(1 for target in all_targets if target.get("status") == "visited"),
        "completed": sum(1 for target in all_targets if target.get("status") == "completed"),
        "skipped": sum(1 for target in all_targets if target.get("status") == "skipped"),
        "error": sum(1 for target in all_targets if target.get("status") == "error"),
        "cancelled": sum(1 for target in all_targets if target.get("status") == "cancelled"),
        "blocked": len(batch_skipped_targets),
        "remaining": len(remaining_targets),
        "total": len(all_targets) + len(batch_skipped_targets),
    }
    artifacts = _delivery_bundle_artifacts(project_id, dispatch_sessions, coverage.get("sourceSegmentId"))

    return {
        "status": handoff.get("status"),
        "readyForDelivery": handoff.get("readyForDelivery", False),
        "checkedAt": now_iso(),
        "projectId": project_id,
        "conversationId": project.get("conversationId", ""),
        "sourceSegmentId": coverage.get("sourceSegmentId"),
        "sourceMediaUrl": coverage.get("sourceMediaUrl", ""),
        "summary": {
            "pages": (coverage.get("summary") or {}).get("total", 0),
            "covered": (coverage.get("summary") or {}).get("covered", 0),
            "readyUnverified": (coverage.get("summary") or {}).get("readyUnverified", 0),
            "blockedPages": (coverage.get("summary") or {}).get("blocked", 0),
            "jobs": len([job for job in jobs if job]),
            "acceptedJobs": len(accepted_jobs),
            "dispatchSessions": len(dispatch_sessions),
            "dispatchTargets": target_status_counts["total"],
            "remainingTargets": target_status_counts["remaining"],
            "pendingTargets": target_status_counts["pending"],
            "visitedTargets": target_status_counts["visited"],
            "completedTargets": target_status_counts["completed"],
            "skippedTargets": target_status_counts["skipped"],
            "errorTargets": target_status_counts["error"],
            "cancelledTargets": target_status_counts["cancelled"],
            "blockedTargets": target_status_counts["blocked"],
            "gaps": len(handoff.get("gaps") or []),
            "actions": len(handoff.get("actions") or []),
            "artifacts": len(artifacts),
        },
        "targetStatusCounts": target_status_counts,
        "artifacts": artifacts,
        "dispatchSessions": dispatch_sessions,
        "acceptedJobs": accepted_jobs,
        "remainingTargets": remaining_targets,
        "skippedTargets": skipped_targets,
        "errorTargets": error_targets,
        "cancelledTargets": cancelled_targets,
        "reports": {
            "deliveryReport": delivery_report,
            "coverage": coverage,
            "handoffSnapshot": handoff,
        },
    }


def _generated_media_root() -> Path:
    configured = os.environ.get("STUDIO_GENERATED_DIR")
    module_path = Path(__file__).resolve()
    repo_root = module_path.parents[2] if len(module_path.parents) > 2 else None
    candidates = [
        Path(configured) if configured else None,
        repo_root / "frontend" / "dist" / "generated" if repo_root else None,
        module_path.parent / "frontend" / "dist" / "generated",
        Path("/app/frontend/dist/generated"),
    ]
    for candidate in candidates:
        if candidate:
            candidate.mkdir(parents=True, exist_ok=True)
            return candidate
    raise RuntimeError("No generated media directory configured")


def _timeline_segment_manifest(segment: StudioSegment, index: int) -> dict[str, Any]:
    duration_seconds = int(segment.get("durationSeconds") or segment.get("duration") or 5)
    return {
        "index": index,
        "segmentId": segment.get("id") or "",
        "type": segment.get("type") or "image",
        "status": segment.get("status") or "",
        "prompt": segment.get("prompt") or "",
        "action": segment.get("action") or "",
        "botId": segment.get("botId") or "",
        "botName": segment.get("botName") or "",
        "botSlug": segment.get("botSlug") or "",
        "taskId": segment.get("taskId") or "",
        "mediaUrl": segment.get("url") or "",
        "posterUrl": segment.get("posterUrl") or "",
        "durationSeconds": duration_seconds,
        "evidence": segment.get("evidence") or {},
    }


def _timeline_export_manifest(project: StudioProject, segment_ids: list[str] | None = None) -> dict[str, Any]:
    allowed_ids = set(segment_ids or [])
    source_segments = [
        segment
        for segment in project.get("segments", [])
        if not allowed_ids or str(segment.get("id") or "") in allowed_ids
    ]
    segments = [_timeline_segment_manifest(segment, index + 1) for index, segment in enumerate(source_segments)]
    video_segments = [segment for segment in segments if segment.get("type") == "video" and segment.get("mediaUrl")]
    ready_segments = [segment for segment in segments if segment.get("mediaUrl") or segment.get("posterUrl")]
    return {
        "kind": "dreamy-long-video-sequence",
        "projectId": project.get("projectId") or "",
        "conversationId": project.get("conversationId") or "",
        "createdAt": now_iso(),
        "segments": segments,
        "summary": {
            "totalSegments": len(segments),
            "readySegments": len(ready_segments),
            "videoSegments": len(video_segments),
            "estimatedDurationSeconds": sum(int(segment.get("durationSeconds") or 5) for segment in segments),
        },
    }


def _resolve_generated_media_path(url: str) -> Path | None:
    if not url.startswith("/generated/"):
        return None
    root = _generated_media_root()
    relative = url.removeprefix("/generated/").lstrip("/")
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError:
        return None
    return candidate if candidate.exists() else None


def _download_timeline_media(media_url: str, output_path: Path) -> None:
    headers = {
        "User-Agent": "MyShell-Studio-Timeline-Export/1.0",
        "Accept": "video/mp4,video/*,*/*",
    }
    try:
        with httpx.stream("GET", media_url, headers=headers, follow_redirects=True, timeout=90.0) as response:
            response.raise_for_status()
            with output_path.open("wb") as media_file:
                for chunk in response.iter_bytes():
                    if chunk:
                        media_file.write(chunk)
    except httpx.HTTPError as exc:
        raise RuntimeError(f"failed to download timeline media: {_exception_message(exc)}") from exc
    if not output_path.exists() or output_path.stat().st_size <= 0:
        raise RuntimeError("downloaded timeline media was empty")


def _prepare_timeline_video_input(media_url: str, target_dir: Path, index: int) -> Path:
    generated_path = _resolve_generated_media_path(media_url)
    suffix = Path(urlsplit(media_url).path).suffix or ".mp4"
    output_path = target_dir / f"segment-{index:03d}{suffix}"
    if generated_path:
        shutil.copyfile(generated_path, output_path)
        return output_path
    if media_url.startswith("http://") or media_url.startswith("https://"):
        _download_timeline_media(media_url, output_path)
        return output_path
    raise ValueError(f"Unsupported timeline media URL: {media_url}")


def _compose_timeline_video(export_id: str, video_segments: list[dict[str, Any]]) -> dict[str, Any]:
    if not video_segments:
        return {"status": "needs_media", "message": "No video segments are ready to compose."}
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        return {"status": "manifest_ready", "message": "FFmpeg is not available; timeline manifest is ready."}

    output_root = _generated_media_root() / "studio-exports"
    output_root.mkdir(parents=True, exist_ok=True)
    output_path = output_root / f"{export_id}.mp4"
    with tempfile.TemporaryDirectory(prefix=f"{export_id}-") as temp_name:
        temp_dir = Path(temp_name)
        input_paths: list[Path] = []
        for index, segment in enumerate(video_segments, start=1):
            input_paths.append(_prepare_timeline_video_input(str(segment.get("mediaUrl") or ""), temp_dir, index))
        if len(input_paths) == 1:
            shutil.copyfile(input_paths[0], output_path)
            return {
                "status": "ready",
                "mediaUrl": f"/generated/studio-exports/{output_path.name}",
                "message": "Composed 1 video segment.",
            }
        concat_path = temp_dir / "concat.txt"
        concat_path.write_text(
            "\n".join(f"file '{path.as_posix()}'" for path in input_paths) + "\n",
            encoding="utf-8",
        )
        copy_command = [ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_path), "-c", "copy", str(output_path)]
        copy_result = subprocess.run(copy_command, capture_output=True, text=True, timeout=180)
        if copy_result.returncode != 0:
            encode_command = [
                ffmpeg,
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(concat_path),
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                str(output_path),
            ]
            encode_result = subprocess.run(encode_command, capture_output=True, text=True, timeout=240)
            if encode_result.returncode != 0:
                raise RuntimeError((encode_result.stderr or copy_result.stderr or "FFmpeg compose failed").strip()[-1200:])

    return {
        "status": "ready",
        "mediaUrl": f"/generated/studio-exports/{output_path.name}",
        "message": f"Composed {len(video_segments)} video segment{'' if len(video_segments) == 1 else 's'}.",
    }


def _create_timeline_export(project: StudioProject, segment_ids: list[str] | None = None) -> dict[str, Any]:
    export_id = make_id("timeline_export")
    manifest = _timeline_export_manifest(project, segment_ids)
    video_segments = [segment for segment in manifest["segments"] if segment.get("type") == "video" and segment.get("mediaUrl")]
    try:
        compose_result = _compose_timeline_video(export_id, video_segments)
    except Exception as error:
        compose_result = {
            "status": "manifest_ready",
            "message": f"Video compose skipped: {type(error).__name__}: {_exception_message(error)}",
        }

    status = compose_result.get("status") or ("needs_media" if not video_segments else "manifest_ready")
    media_url = compose_result.get("mediaUrl") or ""
    evidence = _evidence(
        status,
        "timeline-export",
        accepted=status == "ready" and bool(media_url),
        media_url=media_url,
        task_id=export_id,
        message=compose_result.get("message") or "Timeline manifest is ready.",
    )
    export = {
        "exportId": export_id,
        "projectId": project["projectId"],
        "conversationId": project.get("conversationId") or "",
        "status": status,
        "checkedAt": evidence["checkedAt"],
        "mediaUrl": media_url,
        "manifest": manifest,
        "summary": manifest["summary"],
        "evidence": evidence,
    }
    exports = project.setdefault("timelineExports", [])
    exports.insert(0, export)
    del exports[20:]
    project["updatedAt"] = now_iso()
    _save_project(project)
    return export


DREAMY_API_PREFIX = "/v1/telegram/miniapp/dreamy"
DREAMYPORN_WEB_GENERATE_PREFIX = "/v1/homepage/porn"
DREAMYPORN_UPLOAD_PREFIX = "/v1/resource"
DREAMYPORN_COOKIE_DOMAIN_FRAGMENT = "dreamyporn.ai"
DREAMYPORN_UPLOAD_CONTENT_TYPES = {
    "image/png": 3,
    "image/jpeg": 4,
    "image/jpg": 4,
    "image/webp": 12,
}


def _env_int(name: str, default: int, *, minimum: int = 1, maximum: int = 100) -> int:
    try:
        value = int(os.environ.get(name) or default)
    except ValueError:
        return default
    return max(minimum, min(value, maximum))


def _env_float(name: str, default: float, *, minimum: float = 0.0, maximum: float = 60.0) -> float:
    try:
        value = float(os.environ.get(name) or default)
    except ValueError:
        return default
    return max(minimum, min(value, maximum))


async def _dreamy_api_request(endpoint: str, body: dict[str, Any], init_data: str) -> dict[str, Any]:
    timeout = _env_float("DREAMY_API_TIMEOUT_SECONDS", 30.0, minimum=1.0, maximum=120.0)
    url = f"{dreamy_api_base_url()}{endpoint}"
    headers = {
        "Content-Type": "application/json",
        "myshell-service-name": "organics-api",
        "X-Telegram-Init-Data": init_data,
        "Accept-Language": os.environ.get("DREAMY_ACCEPT_LANGUAGE") or "en",
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, headers=headers, json=body)
    text = response.text
    if response.status_code >= 400:
        message = text[:500] if text else response.reason_phrase
        raise RuntimeError(f"Dreamy API {response.status_code} {endpoint}: {message}")
    if not text.strip():
        return {}
    try:
        payload = response.json()
    except Exception as exc:
        raise RuntimeError(f"Dreamy API returned invalid JSON for {endpoint}: {exc}") from exc
    return payload if isinstance(payload, dict) else {"data": payload}


def _dreamyporn_timestamp(now_ms: int) -> int:
    base = (now_ms - now_ms % 10) // 10
    alternate = False
    checksum = 0
    value = base
    while value:
        digit = value % 10
        checksum += (5 if alternate else 2) * digit
        value = (value - digit) // 10
        alternate = not alternate
    return 10 * base + checksum % 10


def _dreamyporn_cookie_header() -> str:
    cookies = cookie_source_payload()
    return "; ".join(
        f"{cookie.get('name')}={cookie.get('value')}"
        for cookie in cookies
        if isinstance(cookie, dict)
        and cookie.get("name")
        and cookie.get("value") is not None
        and DREAMYPORN_COOKIE_DOMAIN_FRAGMENT in str(cookie.get("domain") or "")
    )


async def _dreamyporn_web_request(endpoint: str, body: dict[str, Any]) -> dict[str, Any]:
    cookie_header = _dreamyporn_cookie_header()
    if not cookie_header:
        raise RuntimeError("DreamyPorn web cookies are missing; no external generation request was sent.")
    timeout = _env_float("DREAMYPORN_API_TIMEOUT_SECONDS", 30.0, minimum=1.0, maximum=120.0)
    url = f"{dreamyporn_web_api_base_url()}{endpoint}"
    now_ms = int(datetime.now(UTC).timestamp() * 1000)
    headers = {
        "Content-Type": "application/json",
        "myshell-service-name": "organics-api",
        "platform": "web",
        "version": "1.0.0",
        "Accept-Language": os.environ.get("DREAMY_ACCEPT_LANGUAGE") or "en",
        "myshell-client-version": os.environ.get("DREAMYPORN_CLIENT_VERSION") or "v1.6.4",
        "timestamp": str(_dreamyporn_timestamp(now_ms)),
        "Cookie": cookie_header,
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, headers=headers, json=body)
    text = response.text
    if response.status_code >= 400:
        message = text[:500] if text else response.reason_phrase
        raise RuntimeError(f"DreamyPorn web API {response.status_code} {endpoint}: {message}")
    if not text.strip():
        return {}
    try:
        payload = response.json()
    except Exception as exc:
        raise RuntimeError(f"DreamyPorn web API returned invalid JSON for {endpoint}: {exc}") from exc
    return payload if isinstance(payload, dict) else {"data": payload}


def _dreamyporn_default_input_image_file() -> Path | None:
    configured = os.environ.get("DREAMYPORN_DEFAULT_INPUT_IMAGE_FILE")
    candidates = [Path(configured)] if configured else []
    backend_path = Path(__file__).resolve()
    candidates.extend(
        [
            backend_path.parents[2] / "frontend" / "public" / "generated" / "bot-previews" / "seedance-free.jpg",
            backend_path.parents[2] / "frontend" / "dist" / "generated" / "bot-previews" / "seedance-free.jpg",
            Path("/app/frontend/dist/generated/bot-previews/seedance-free.jpg"),
        ]
    )
    return next((path for path in candidates if path and path.exists()), None)


def _guess_image_content_type(filename: str, fallback: str = "image/jpeg") -> str:
    suffix = Path(filename).suffix.lower()
    if suffix == ".png":
        return "image/png"
    if suffix == ".webp":
        return "image/webp"
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    return fallback


async def _dreamyporn_upload_image(
    image_bytes: bytes,
    *,
    filename: str,
    content_type: str,
) -> str:
    content_type = content_type or _guess_image_content_type(filename)
    content_type_id = DREAMYPORN_UPLOAD_CONTENT_TYPES.get(content_type, DREAMYPORN_UPLOAD_CONTENT_TYPES["image/jpeg"])
    presign = await _dreamyporn_web_request(
        f"{DREAMYPORN_UPLOAD_PREFIX}/get_put_object_pre_sign_url",
        {
            "file_info": {
                "scenario": 19,
                "content_type": content_type_id,
                "file_name": filename or "studio-source.jpg",
                "content_length": str(len(image_bytes)),
            }
        },
    )
    upload_url = str(presign.get("uploadUrl") or presign.get("upload_url") or "")
    object_access_url = str(presign.get("objectAccessUrl") or presign.get("object_access_url") or "")
    expires_at = str(presign.get("expiresAt") or presign.get("expires_at") or "")
    presign_content_type = str(presign.get("contentType") or presign.get("content_type") or content_type)
    if not upload_url or not object_access_url:
        raise RuntimeError("DreamyPorn upload presign response did not include uploadUrl/objectAccessUrl")
    headers = {"Content-Type": presign_content_type}
    if expires_at:
        headers["Expires"] = expires_at
    async with httpx.AsyncClient(timeout=_env_float("DREAMYPORN_UPLOAD_TIMEOUT_SECONDS", 60.0, minimum=1.0, maximum=180.0)) as client:
        response = await client.put(upload_url, headers=headers, content=image_bytes)
    if response.status_code >= 400:
        raise RuntimeError(f"DreamyPorn upload failed: HTTP {response.status_code}")
    return object_access_url


def _dreamyporn_source_media_url(source_segment: StudioSegment | None) -> str:
    if not source_segment:
        return ""
    candidate = str(source_segment.get("url") or "")
    if candidate.startswith("http") and ".mp4" not in candidate.lower():
        return candidate
    poster = str(source_segment.get("posterUrl") or "")
    return poster if poster.startswith("http") else ""


async def _dreamyporn_web_input_images(
    *,
    source_segment: StudioSegment | None,
    input_image_bytes: bytes | None,
    input_image_filename: str,
    input_image_content_type: str,
) -> list[str]:
    source_url = _dreamyporn_source_media_url(source_segment)
    if source_url:
        return [source_url]
    configured_url = os.environ.get("DREAMYPORN_DEFAULT_INPUT_IMAGE_URL", "").strip()
    if configured_url:
        return [configured_url]
    if input_image_bytes:
        return [
            await _dreamyporn_upload_image(
                input_image_bytes,
                filename=input_image_filename or "studio-source.jpg",
                content_type=input_image_content_type or _guess_image_content_type(input_image_filename),
            )
        ]
    default_file = _dreamyporn_default_input_image_file()
    if default_file:
        return [
            await _dreamyporn_upload_image(
                default_file.read_bytes(),
                filename=default_file.name,
                content_type=_guess_image_content_type(default_file.name),
            )
        ]
    raise RuntimeError("DreamyPorn web generation requires a source image, source segment, or DREAMYPORN_DEFAULT_INPUT_IMAGE_URL.")


def _dreamyporn_web_task_media(result: dict[str, Any], output_job_id: str) -> dict[str, str]:
    tasks = result.get("tasks") if isinstance(result.get("tasks"), list) else []
    task = next(
        (
            candidate
            for candidate in tasks
            if isinstance(candidate, dict)
            and str(candidate.get("jobId") or candidate.get("job_id") or candidate.get("taskId") or "") == output_job_id
        ),
        {},
    )
    parsed_result = _json_object(task.get("result"))
    media_url = (
        parsed_result.get("outputImg")
        or parsed_result.get("output_img")
        or parsed_result.get("outputPreview")
        or parsed_result.get("output_preview")
        or ""
    )
    poster_url = parsed_result.get("outputPoster") or parsed_result.get("output_poster") or parsed_result.get("outputPreview") or media_url or ""
    task_status = str(task.get("status") or result.get("status") or "running")
    queue_position = str(task.get("queuePosition") or task.get("queue_position") or "")
    return {
        "status": task_status,
        "taskId": output_job_id,
        "mediaUrl": str(media_url or ""),
        "posterUrl": str(poster_url or ""),
        "queuePosition": queue_position,
    }


async def _poll_dreamyporn_web_job_result(job: dict[str, Any]) -> tuple[dict[str, Any], StudioProject | None]:
    project = _get_project(str(job.get("projectId") or ""))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    segment = _find_segment(project, str(job.get("segmentId") or ""))
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")
    task_id = str(job.get("taskId") or segment.get("taskId") or "")
    if not task_id:
        raise HTTPException(status_code=409, detail="Dreamy job has no task id to poll")
    auth_status = adapter_auth_status("dreamy-miniapp")
    result = await _dreamyporn_web_request(f"{DREAMYPORN_WEB_GENERATE_PREFIX}/generate_result", {})
    media = _dreamyporn_web_task_media(result, task_id)
    job = _apply_dreamy_media_to_job(
        project,
        segment,
        job,
        media,
        auth_status=auth_status,
        message_prefix="DreamyPorn web poll.",
    )
    return job, project


async def _run_dreamyporn_web_adapter(
    *,
    project: StudioProject,
    segment: StudioSegment,
    job: dict[str, Any],
    route: dict[str, Any],
    prompt: str,
    source_segment: StudioSegment | None,
    input_image_bytes: bytes | None = None,
    input_image_filename: str = "",
    input_image_content_type: str = "",
) -> dict[str, Any]:
    auth_status = adapter_auth_status("dreamy-miniapp")
    if dreamyporn_web_cookie_status().get("status") != "ready":
        segment["status"] = "auth_missing"
        segment["authStatus"] = auth_status
        segment["evidence"] = _evidence(
            "auth_missing",
            "dreamy-miniapp",
            message="DreamyPorn web cookies are missing; no external generation request was sent.",
        )
        segment["updatedAt"] = now_iso()
        job = _update_job(job, status="auth_missing", authStatus=auth_status, evidence=segment["evidence"])
        _set_graph_status(project, route, segment)
        _save_project(project)
        _sync_project_jobs(project)
        return job

    bot_id = str(route["bot"].get("id") or route["bot"].get("botId") or job.get("botId") or segment.get("botId") or "").strip()
    article_id = str(route["bot"].get("articleId") or job.get("articleId") or segment.get("articleId") or route["bot"].get("slug") or "").strip()
    if not bot_id or not article_id:
        raise RuntimeError("DreamyPorn web generation requires explicit botId and articleId from the selected Dreamy bot.")

    segment["status"] = "running"
    segment["authStatus"] = auth_status
    segment["updatedAt"] = now_iso()
    running_evidence = _evidence(
        "running",
        "dreamy-miniapp",
        message="DreamyPorn web generation submitted from Studio.",
    )
    job = _update_job(job, status="running", authStatus=auth_status, evidence=running_evidence)
    _set_graph_status(project, route, segment)
    _save_project(project)
    _sync_project_jobs(project)

    input_images = await _dreamyporn_web_input_images(
        source_segment=source_segment,
        input_image_bytes=input_image_bytes,
        input_image_filename=input_image_filename,
        input_image_content_type=input_image_content_type,
    )
    response = await _dreamyporn_web_request(
        f"{DREAMYPORN_WEB_GENERATE_PREFIX}/generate",
        {
            "botId": bot_id,
            "inputImg": input_images,
            "articleId": article_id,
        },
    )
    output_job_id = str(response.get("outputJobId") or response.get("output_job_id") or "")
    if not output_job_id:
        raise RuntimeError("DreamyPorn web generate response did not include outputJobId")

    poll_attempts = _env_int("DREAMY_SERVER_POLL_ATTEMPTS", 3, minimum=1, maximum=20)
    poll_interval = _env_float("DREAMY_SERVER_POLL_INTERVAL_SECONDS", 0.75, minimum=0.0, maximum=30.0)
    media: dict[str, str] = {"status": "running", "taskId": output_job_id, "mediaUrl": "", "posterUrl": ""}
    for attempt in range(poll_attempts):
        if attempt and poll_interval:
            await asyncio.sleep(poll_interval)
        result = await _dreamyporn_web_request(f"{DREAMYPORN_WEB_GENERATE_PREFIX}/generate_result", {})
        media = _dreamyporn_web_task_media(result, output_job_id)
        if media.get("mediaUrl") and media.get("status") in {"completed", "success", "done"}:
            break

    media["taskId"] = media.get("taskId") or output_job_id
    job = _apply_dreamy_media_to_job(
        project,
        segment,
        job,
        media,
        auth_status=auth_status,
        message_prefix="DreamyPorn web submit.",
    )
    evidence = job.get("evidence") if isinstance(job.get("evidence"), dict) else {}
    evidence.update(
        {
            "executor": "dreamyporn-web",
            "articleId": article_id,
            "botId": bot_id,
            "queuePosition": media.get("queuePosition", ""),
            "inputImageCount": len(input_images),
        }
    )
    segment["evidence"] = evidence
    job = _update_job(job, evidence=evidence)
    _save_project(project)
    _sync_project_jobs(project)
    return job


def _dreamy_floor_defaults() -> list[dict[str, str]]:
    return [
        {"title": "Celebrity Style", "floorUrl": "celeb-sex"},
        {"title": "Sexy Outfits", "floorUrl": "sexy-outfits"},
        {"title": "Classic Acts", "floorUrl": "classic-acts"},
        {"title": "Wild Encounters", "floorUrl": "wild-encounters"},
        {"title": "LGBT", "floorUrl": "lgbt-sex"},
    ]


def _dreamy_catalog_bot_from_image(item: dict[str, Any], floor: dict[str, Any]) -> dict[str, Any] | None:
    slug = _slug_from_dreamy_goto_link(str(item.get("gotoLink") or item.get("goto_link") or ""))
    if not slug:
        return None
    name = str(item.get("title") or item.get("botName") or item.get("bot_name") or slug)
    image_url = str(item.get("imagePosterUrl") or item.get("image_poster_url") or item.get("imageUrl") or item.get("image_url") or "")
    template_url = str(item.get("templatePosterUrl") or item.get("template_poster_url") or item.get("templateUrl") or item.get("template_url") or "")
    return {
        "slug": slug,
        "name": name,
        "icon": "dreamy",
        "type": _dreamy_catalog_type_from_media(item),
        "desc": f"Dreamy miniapp bot from {floor.get('title') or floor.get('floorUrl') or 'catalog'}.",
        "keywords": ["dreamy", str(floor.get("floorUrl") or ""), name.lower()],
        "rating": 4.6,
        "pageId": "dreamy-miniapp",
        "floorUrl": floor.get("floorUrl") or "",
        "imageUrl": image_url or template_url,
        "templateUrl": template_url,
    }


async def _dreamy_catalog_bots() -> tuple[list[dict[str, Any]], str]:
    init_data = dreamy_init_data()
    auth_status = adapter_auth_status("dreamy-miniapp")
    if not init_data and dreamyporn_web_cookie_status().get("status") == "ready":
        bots: list[dict[str, Any]] = []
        seen: set[str] = set()
        for floor in _dreamy_floor_defaults():
            floor_url = str(floor.get("floorUrl") or "")
            if not floor_url:
                continue
            try:
                payload = await _dreamyporn_web_request(
                    f"{DREAMYPORN_WEB_GENERATE_PREFIX}/explore",
                    {"floorUrl": floor_url, "page": 1, "pageSize": 100},
                )
            except Exception:
                continue
            response_floors = payload.get("floors") if isinstance(payload.get("floors"), list) else []
            for response_floor in response_floors:
                if not isinstance(response_floor, dict):
                    continue
                images = response_floor.get("images") if isinstance(response_floor.get("images"), list) else []
                merged_floor = {**floor, **response_floor}
                for image in images:
                    if not isinstance(image, dict):
                        continue
                    bot = _dreamy_catalog_bot_from_image(image, merged_floor)
                    if not bot or bot["slug"] in seen:
                        continue
                    seen.add(bot["slug"])
                    bots.append(bot)
        return (bots or DREAMY_BOTS), "live-dreamyporn-web-explore" if bots else "seed-empty-web"

    if not init_data or auth_status.get("status") != "ready":
        return DREAMY_BOTS, "seed-auth-missing"

    floors: list[dict[str, Any]] = _dreamy_floor_defaults()
    try:
        init_payload = await _dreamy_api_request(f"{DREAMY_API_PREFIX}/init", {}, init_data)
        init_floors = init_payload.get("floors")
        if isinstance(init_floors, list) and init_floors:
            floors = [floor for floor in init_floors if isinstance(floor, dict) and floor.get("floorUrl")]
    except Exception:
        floors = _dreamy_floor_defaults()

    bots: list[dict[str, Any]] = []
    seen: set[str] = set()
    for floor in floors:
        floor_url = str(floor.get("floorUrl") or "")
        if not floor_url:
            continue
        try:
            payload = await _dreamy_api_request(
                f"{DREAMY_API_PREFIX}/explore",
                {"floor_url": floor_url, "page": 1, "page_size": 100},
                init_data,
            )
        except Exception:
            continue
        response_floors = payload.get("floors") if isinstance(payload.get("floors"), list) else []
        for response_floor in response_floors:
            if not isinstance(response_floor, dict):
                continue
            images = response_floor.get("images") if isinstance(response_floor.get("images"), list) else []
            merged_floor = {**floor, **response_floor}
            for image in images:
                if not isinstance(image, dict):
                    continue
                bot = _dreamy_catalog_bot_from_image(image, merged_floor)
                if not bot or bot["slug"] in seen:
                    continue
                seen.add(bot["slug"])
                bots.append(bot)

    return (bots or DREAMY_BOTS), "live-dreamy-explore" if bots else "seed-empty-live"


def _json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _dreamy_task_media(result: dict[str, Any], output_job_id: str = "") -> dict[str, str]:
    tasks = result.get("tasks") if isinstance(result.get("tasks"), list) else []
    task = tasks[0] if tasks and isinstance(tasks[0], dict) else {}
    parsed_result = _json_object(task.get("result"))
    media_url = (
        parsed_result.get("outputImg")
        or parsed_result.get("output_img")
        or parsed_result.get("outputPreview")
        or parsed_result.get("output_preview")
        or parsed_result.get("mediaUrl")
        or parsed_result.get("media_url")
        or parsed_result.get("url")
        or ""
    )
    poster_url = (
        parsed_result.get("outputPoster")
        or parsed_result.get("output_poster")
        or parsed_result.get("outputPreview")
        or parsed_result.get("output_preview")
        or media_url
        or ""
    )
    return {
        "status": str(task.get("status") or result.get("status") or ""),
        "taskId": str(task.get("jobId") or task.get("taskId") or output_job_id or ""),
        "mediaUrl": str(media_url or ""),
        "posterUrl": str(poster_url or ""),
    }


def _dreamy_input_images(prompt: str, source_segment: StudioSegment | None) -> list[str]:
    source_url = _accepted_source_media_url(source_segment)
    return [source_url, prompt] if source_url else [prompt]


def _job_route_for_graph(job: dict[str, Any], analysis: str = "Dreamy result refreshed.") -> dict[str, Any]:
    return {
        "bot": {
            "slug": job.get("botSlug") or "",
            "name": job.get("botName") or "Dreamy Miniapp",
            "type": job.get("botType") or "image",
        },
        "executor": job.get("executor") or "server",
        "analysis": analysis,
        "sourceSummary": "Timeline updated from persisted job evidence.",
    }


def _evidence_with_job_context(job: dict[str, Any], evidence: dict[str, Any]) -> dict[str, Any]:
    current = job.get("evidence") if isinstance(job.get("evidence"), dict) else {}
    context_keys = (
        "dispatchSessionId",
        "dispatchTargetId",
        "dispatchTargetPageId",
        "coverageVerification",
    )
    return {
        **{key: current[key] for key in context_keys if current.get(key)},
        **evidence,
    }


def _sync_dispatch_target_from_polled_job(job: dict[str, Any], segment: StudioSegment, status: str) -> None:
    evidence = job.get("evidence") if isinstance(job.get("evidence"), dict) else {}
    dispatch_session_id = evidence.get("dispatchSessionId")
    dispatch_target_id = evidence.get("dispatchTargetId")
    if not dispatch_session_id or not dispatch_target_id:
        return
    if status not in {"done", "error", "timeout", "auth_missing", "cancelled"}:
        return
    target_status = "completed" if status == "done" and (segment.get("evidence") or {}).get("accepted") else "error"
    try:
        _update_dispatch_session_target(
            str(dispatch_session_id),
            str(dispatch_target_id),
            status=target_status,
            evidence={
                "dispatchSessionId": str(dispatch_session_id),
                "dispatchTargetId": str(dispatch_target_id),
                "jobId": segment.get("jobId") or job.get("jobId") or "",
                "segmentId": segment.get("id") or "",
                "accepted": bool((segment.get("evidence") or {}).get("accepted")),
                "mediaUrl": segment.get("url") or "",
                "posterUrl": segment.get("posterUrl") or "",
                "taskId": segment.get("taskId") or job.get("taskId") or "",
                "message": (segment.get("evidence") or {}).get("message") or "",
            },
        )
    except HTTPException:
        return


def _apply_dreamy_media_to_job(
    project: StudioProject,
    segment: StudioSegment,
    job: dict[str, Any],
    media: dict[str, str],
    *,
    auth_status: dict[str, Any],
    message_prefix: str,
) -> dict[str, Any]:
    output_job_id = media.get("taskId") or job.get("taskId") or segment.get("taskId") or ""
    task_status = (media.get("status") or "running").lower()
    media_url = media.get("mediaUrl") or ""
    poster_url = media.get("posterUrl") or segment.get("posterUrl") or media_url
    queue_position = media.get("queuePosition") or ""

    if media_url and task_status in {"completed", "success", "done"}:
        normalized_status = "done"
        segment["url"] = media_url
        segment["posterUrl"] = poster_url
        evidence = _evidence(
            "done",
            "dreamy-miniapp",
            accepted=True,
            media_url=media_url,
            task_id=output_job_id,
            message=f"{message_prefix} Fresh Dreamy task media accepted.",
        )
        job_patch = {
            "status": "done",
            "taskId": output_job_id,
            "mediaUrl": media_url,
            "posterUrl": poster_url,
        }
    elif task_status in {"failed", "failure", "error", "cancelled", "canceled"}:
        normalized_status = "error"
        evidence = _evidence(
            "error",
            "dreamy-miniapp",
            task_id=output_job_id,
            message=f"{message_prefix} Dreamy task {output_job_id} returned {task_status}.",
        )
        job_patch = {"status": "error", "taskId": output_job_id, "posterUrl": poster_url}
    else:
        normalized_status = "running"
        evidence = _evidence(
            "running",
            "dreamy-miniapp",
            task_id=output_job_id,
            message=f"{message_prefix} Dreamy task {output_job_id} is {task_status or 'running'}; poll result for final media.",
        )
        job_patch = {"status": "running", "taskId": output_job_id, "posterUrl": poster_url}

    if queue_position:
        evidence["queuePosition"] = queue_position
    if task_status:
        evidence["rawTaskStatus"] = task_status

    evidence = _evidence_with_job_context(job, evidence)
    segment["status"] = normalized_status
    segment["taskId"] = output_job_id
    segment["authStatus"] = auth_status
    segment["evidence"] = evidence
    segment["updatedAt"] = now_iso()
    job = _update_job(
        job,
        **job_patch,
        authStatus=auth_status,
        evidence=evidence,
    )
    _set_graph_status(project, _job_route_for_graph(job), segment)
    _save_project(project)
    _sync_project_jobs(project)
    _sync_dispatch_target_from_polled_job(job, segment, normalized_status)
    return job


async def _poll_dreamy_job_result(job: dict[str, Any]) -> tuple[dict[str, Any], StudioProject | None]:
    if job.get("pageId") != "dreamy-miniapp":
        raise HTTPException(status_code=409, detail="Only Dreamy miniapp jobs can be polled through this endpoint")
    project = _get_project(str(job.get("projectId") or ""))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    segment = _find_segment(project, str(job.get("segmentId") or ""))
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")

    task_id = str(job.get("taskId") or segment.get("taskId") or "")
    auth_status = adapter_auth_status("dreamy-miniapp")
    if not dreamy_init_data() and dreamyporn_web_cookie_status().get("status") == "ready":
        return await _poll_dreamyporn_web_job_result(job)

    if not dreamy_init_data() or auth_status.get("status") != "ready":
        evidence = _evidence_with_job_context(
            job,
            _evidence(
                "auth_missing",
                "dreamy-miniapp",
                task_id=task_id,
                message="Dreamy server polling needs DREAMY_TELEGRAM_INIT_DATA; result was not requested.",
            ),
        )
        segment["status"] = "auth_missing"
        segment["authStatus"] = auth_status
        segment["evidence"] = evidence
        segment["updatedAt"] = now_iso()
        job = _update_job(job, status="auth_missing", authStatus=auth_status, evidence=evidence)
        _set_graph_status(project, _job_route_for_graph(job, "Dreamy poll auth is missing."), segment)
        _save_project(project)
        _sync_project_jobs(project)
        _sync_dispatch_target_from_polled_job(job, segment, "auth_missing")
        return job, project

    if not task_id:
        raise HTTPException(status_code=409, detail="Dreamy job has no task id to poll")

    result = await _dreamy_api_request(
        f"{DREAMY_API_PREFIX}/generate/result",
        {"output_job_id": task_id},
        dreamy_init_data(),
    )
    media = _dreamy_task_media(result, task_id)
    job = _apply_dreamy_media_to_job(
        project,
        segment,
        job,
        media,
        auth_status=auth_status,
        message_prefix="Server poll.",
    )
    return job, project


async def _run_dreamy_server_adapter(
    *,
    project: StudioProject,
    segment: StudioSegment,
    job: dict[str, Any],
    route: dict[str, Any],
    prompt: str,
    source_segment: StudioSegment | None,
    input_image_bytes: bytes | None = None,
    input_image_filename: str = "",
    input_image_content_type: str = "",
) -> dict[str, Any]:
    init_data = dreamy_init_data()
    auth_status = adapter_auth_status("dreamy-miniapp")
    if not init_data and dreamyporn_web_cookie_status().get("status") == "ready":
        return await _run_dreamyporn_web_adapter(
            project=project,
            segment=segment,
            job=job,
            route=route,
            prompt=prompt,
            source_segment=source_segment,
            input_image_bytes=input_image_bytes,
            input_image_filename=input_image_filename,
            input_image_content_type=input_image_content_type,
        )

    if not init_data or auth_status.get("status") != "ready":
        segment["status"] = "auth_missing"
        segment["authStatus"] = auth_status
        segment["evidence"] = _evidence(
            "auth_missing",
            "dreamy-miniapp",
            message="Dreamy server execution needs DREAMY_TELEGRAM_INIT_DATA; no external generation request was sent.",
        )
        segment["updatedAt"] = now_iso()
        job = _update_job(job, status="auth_missing", authStatus=auth_status, evidence=segment["evidence"])
        _set_graph_status(project, route, segment)
        _save_project(project)
        _sync_project_jobs(project)
        return job

    segment["status"] = "running"
    segment["authStatus"] = auth_status
    segment["updatedAt"] = now_iso()
    running_evidence = _evidence(
        "running",
        "dreamy-miniapp",
        message="Server-side Dreamy generation submitted from Studio.",
    )
    job = _update_job(job, status="running", authStatus=auth_status, evidence=running_evidence)
    _set_graph_status(project, route, segment)
    _save_project(project)
    _sync_project_jobs(project)

    slug = str(route["bot"].get("slug") or "")
    explicit_bot_id = str(
        route["bot"].get("id")
        or route["bot"].get("botId")
        or job.get("botId")
        or segment.get("botId")
        or ""
    ).strip()
    if explicit_bot_id:
        bot_id = explicit_bot_id
        article_id = str(route["bot"].get("articleId") or job.get("articleId") or segment.get("articleId") or slug or bot_id)
    else:
        detail = await _dreamy_api_request(f"{DREAMY_API_PREFIX}/get-by-slug", {"slug_id": slug}, init_data)
        info = detail.get("info") if isinstance(detail.get("info"), dict) else {}
        bot_id = str(info.get("botId") or info.get("bot_id") or slug)
        article_id = str(info.get("slugId") or info.get("slug_id") or slug)
    generate_body = {
        "bot_id": bot_id,
        "input_img": _dreamy_input_images(prompt, source_segment),
        "article_id": article_id,
    }
    response = await _dreamy_api_request(f"{DREAMY_API_PREFIX}/generate", generate_body, init_data)
    output_job_id = str(response.get("outputJobId") or response.get("output_job_id") or "")
    if not output_job_id:
        raise RuntimeError("Dreamy generate response did not include outputJobId")

    poll_attempts = _env_int("DREAMY_SERVER_POLL_ATTEMPTS", 3, minimum=1, maximum=20)
    poll_interval = _env_float("DREAMY_SERVER_POLL_INTERVAL_SECONDS", 0.75, minimum=0.0, maximum=10.0)
    media: dict[str, str] = {"status": "running", "taskId": output_job_id, "mediaUrl": "", "posterUrl": ""}
    for attempt in range(poll_attempts):
        if attempt and poll_interval:
            await asyncio.sleep(poll_interval)
        result = await _dreamy_api_request(
            f"{DREAMY_API_PREFIX}/generate/result",
            {"output_job_id": output_job_id},
            init_data,
        )
        media = _dreamy_task_media(result, output_job_id)
        if media.get("mediaUrl") and media.get("status") in {"completed", "success", "done"}:
            break

    media["taskId"] = media.get("taskId") or output_job_id
    return _apply_dreamy_media_to_job(
        project,
        segment,
        job,
        media,
        auth_status=auth_status,
        message_prefix="Server submit.",
    )


def _build_execution_request(project: StudioProject, job: dict[str, Any]) -> dict[str, Any]:
    page = get_page(job.get("pageId"))
    segment = _find_segment(project, job.get("segmentId")) or {
        "id": job.get("segmentId"),
        "type": "video" if job.get("botType") == "image-to-video" else "image",
        "url": job.get("mediaUrl", ""),
        "posterUrl": job.get("posterUrl", ""),
        "prompt": job.get("prompt", ""),
        "botId": job.get("botId", ""),
        "articleId": job.get("articleId", ""),
        "botSlug": job.get("botSlug", ""),
        "botName": job.get("botName", ""),
        "action": job.get("action", "generate"),
        "parentSegmentId": None,
        "status": job.get("status", "queued"),
        "taskId": job.get("taskId", ""),
        "jobId": job.get("jobId", ""),
        "authStatus": job.get("authStatus") or adapter_auth_status(page["id"]),
        "evidence": job.get("evidence") or {},
        "createdAt": job.get("createdAt", now_iso()),
        "updatedAt": job.get("updatedAt", now_iso()),
    }
    bot = get_dreamy_bot_by_slug(job.get("botSlug", "")) or get_bot_by_slug(job.get("botSlug", "")) or {
        "id": job.get("botId", ""),
        "slug": job.get("botSlug", ""),
        "name": job.get("botName", ""),
        "type": job.get("botType", segment.get("type", "image")),
        "articleId": job.get("articleId", ""),
        "rating": 4.5,
        "desc": "",
    }
    source_segment = _find_segment(project, segment.get("parentSegmentId"))
    route = {
        "bot": {
            "id": bot.get("id") or job.get("botId", ""),
            "slug": bot.get("slug") or job.get("botSlug"),
            "name": bot.get("name") or job.get("botName"),
            "type": bot.get("type") or job.get("botType"),
            "articleId": bot.get("articleId") or job.get("articleId", ""),
            "rating": bot.get("rating", 4.5),
            "description": bot.get("desc", ""),
            "pageUrl": (
                f"/bot?slug_id={quote(str(bot.get('slug') or job.get('botSlug') or ''))}"
                if page["id"] == "dreamy-miniapp"
                else f"https://art.myshell.ai/creative/{bot.get('slug') or job.get('botSlug')}"
            ),
        },
        "executor": page["executor"],
        "analysis": "Retry queued from persisted Studio job.",
        "sourceSummary": f"Using segment {segment.get('parentSegmentId')}" if segment.get("parentSegmentId") else "Retrying original prompt",
    }
    graph = _set_graph_status(project, route, segment)
    contract = _navigation_contract(page, route, source_segment)
    navigation_path = contract.get("navigationPath", "")
    evidence = job.get("evidence") or {}
    request = {
        "executor": page["executor"],
        "api": page["id"],
        "page": page,
        "agentId": job.get("agentId") or _agent_id_for_page(page),
        **contract,
        "routeParams": page.get("routeParams") or [],
        "missingRouteParams": _missing_route_params(page, navigation_path),
        "jobId": job["jobId"],
        "segmentId": job["segmentId"],
        "botId": job.get("botId", ""),
        "articleId": job.get("articleId", ""),
        "botSlug": job.get("botSlug", ""),
        "botName": job.get("botName", ""),
        "botType": job.get("botType", ""),
        "prompt": job.get("prompt", ""),
        "action": job.get("action", "generate"),
        "sourceSegment": source_segment,
        "agentGraph": graph,
        "segment": segment,
        "authStatus": job.get("authStatus") or adapter_auth_status(page["id"]),
        "evidence": evidence,
    }
    if evidence.get("dispatchSessionId"):
        request["dispatchSessionId"] = evidence.get("dispatchSessionId")
    if evidence.get("dispatchTargetId"):
        request["dispatchTargetId"] = evidence.get("dispatchTargetId")
    return request


def _create_job(
    project: StudioProject,
    segment: StudioSegment,
    route: dict[str, Any],
    page: dict[str, Any],
    source_segment: Optional[StudioSegment] = None,
    status: str = "queued",
    agent_id: str | None = None,
) -> dict[str, Any]:
    auth_status = adapter_auth_status(page["id"])
    evidence = _evidence(
        status,
        page["id"],
        accepted=False,
        message="Waiting for fresh adapter result; placeholders are not accepted as completion evidence.",
    )
    job = {
        "jobId": make_id("job"),
        "projectId": project["projectId"],
        "segmentId": segment["id"],
        "pageId": page["id"],
        "pageName": page["name"],
        "agentId": _agent_id_for_dispatch(page, agent_id),
        "executor": page["executor"],
        "api": page["id"],
        **_navigation_contract(page, route, source_segment),
        "status": status,
        "action": segment["action"],
        "botId": segment.get("botId", ""),
        "articleId": segment.get("articleId", ""),
        "botSlug": segment["botSlug"],
        "botName": segment["botName"],
        "botType": route["bot"].get("type"),
        "prompt": segment["prompt"],
        "taskId": "",
        "mediaUrl": "",
        "posterUrl": segment.get("posterUrl", ""),
        "authStatus": auth_status,
        "evidence": evidence,
        "attempt": 1,
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
    }
    segment["jobId"] = job["jobId"]
    segment["authStatus"] = auth_status
    segment["evidence"] = evidence
    STUDIO_STORE.save_job(job)
    STUDIO_STORE.save_evidence(job, evidence)
    _sync_project_jobs(project)
    return job


def _update_job(job: dict[str, Any], **patch: Any) -> dict[str, Any]:
    job.update({key: value for key, value in patch.items() if value is not None})
    job["updatedAt"] = now_iso()
    STUDIO_STORE.save_job(job)
    if patch.get("evidence"):
        STUDIO_STORE.save_evidence(job, patch["evidence"])
    return job


def _latest_generation_smoke_job() -> dict[str, Any] | None:
    for job in STUDIO_STORE.list_jobs(page_id="dreamy-miniapp", limit=100):
        evidence = job.get("evidence") if isinstance(job.get("evidence"), dict) else {}
        if evidence.get("generationSmoke"):
            return job
    return None


def _generation_smoke_status_from_latest(latest_job: dict[str, Any] | None, prerequisites: dict[str, Any]) -> str:
    prerequisite_status = str(prerequisites.get("status") or "unknown")
    if prerequisite_status in {"needs_configuration", "auth_missing"}:
        return prerequisite_status
    if latest_job and latest_job.get("status") == "done" and latest_job.get("mediaUrl"):
        return "done"
    return "needs_verification"


def _generation_smoke_summary(
    *,
    prerequisites: dict[str, Any],
    latest_job: dict[str, Any] | None,
    executed_job: dict[str, Any] | None = None,
    project: StudioProject | None = None,
    message: str = "",
) -> dict[str, Any]:
    job = executed_job or latest_job
    evidence = job.get("evidence") if isinstance((job or {}).get("evidence"), dict) else {}
    status = str(job.get("status") or "") if executed_job else _generation_smoke_status_from_latest(latest_job, prerequisites)
    if executed_job and status == "done" and not job.get("mediaUrl"):
        status = "error"
    return {
        "status": status or "unknown",
        "readyForLiveRun": prerequisites.get("status") == "ready",
        "checkedAt": now_iso(),
        "message": message
        or (
            "Latest live generation smoke accepted real media."
            if status == "done"
            else prerequisites.get("message", "Live generation smoke has not produced accepted media yet.")
        ),
        "prerequisites": prerequisites,
        "latest": {
            "jobId": job.get("jobId", "") if job else "",
            "projectId": job.get("projectId", "") if job else "",
            "segmentId": job.get("segmentId", "") if job else "",
            "taskId": job.get("taskId", "") if job else "",
            "status": job.get("status", "") if job else "",
            "mediaUrl": job.get("mediaUrl", "") if job else "",
            "posterUrl": job.get("posterUrl", "") if job else "",
            "checkedAt": evidence.get("checkedAt", "") if evidence else "",
            "accepted": bool(evidence.get("accepted")) if evidence else False,
            "message": evidence.get("message", "") if evidence else "",
        },
        "project": {"projectId": project.get("projectId", "")} if project else None,
        "actions": [
            {
                "label": "Create Cloud Run secrets",
                "message": "Create myshell-dreamy-init-data and myshell-cookies, deploy again, then run POST /api/studio/generation-smoke with execute=true.",
                "endpoint": "/api/studio/generation-smoke",
                "missingEnv": prerequisites.get("missingEnv") or [],
            }
        ]
        if prerequisites.get("status") in {"needs_configuration", "auth_missing"}
        else [
            {
                "label": "Run live smoke",
                "message": "POST /api/studio/generation-smoke with execute=true to prove fresh Dreamy media output.",
                "endpoint": "/api/studio/generation-smoke",
            }
        ],
    }


async def _execute_generation_smoke(prompt: str) -> dict[str, Any]:
    project = _project(None, "player")
    prompt = prompt.strip() or "Create a short cinematic neon city source image for live generation smoke."
    _append_message(project, "user", prompt, action="generate", hasImage=False)
    route = await choose_route(prompt, False, "generate", None)
    page = {
        **get_page("dreamy-miniapp"),
        "executor": "server",
        "dispatchMode": "execute-server",
    }
    route["action"] = "generate"
    route["sourceSegmentId"] = None
    route["sourceSummary"] = "Live generation smoke from backend credentials"
    route["page"] = page
    route["api"] = page["id"]
    route["executor"] = page["executor"]
    route["agentId"] = _agent_id_for_dispatch(page, None)
    route.update(_navigation_contract(page, route, None))
    segment = _append_queued_segment(project, route, route.get("optimizedPrompt") or prompt, "generate", None)
    job = _create_job(project, segment, route, page, None, agent_id=route["agentId"])
    smoke_context = {
        "generationSmoke": True,
        "probeId": make_id("generation_smoke"),
        "probeType": "dreamy-server-live",
        "prompt": route.get("optimizedPrompt") or prompt,
    }
    job["evidence"] = {**(job.get("evidence") or {}), **smoke_context}
    STUDIO_STORE.save_job(job)
    STUDIO_STORE.save_evidence(job, job["evidence"])
    try:
        job = await _run_dreamy_server_adapter(
            project=project,
            segment=segment,
            job=job,
            route=route,
            prompt=route.get("optimizedPrompt") or prompt,
            source_segment=None,
        )
    except Exception as exc:
        segment["status"] = "error"
        segment["evidence"] = _evidence("error", "dreamy-miniapp", message=_exception_message(exc))
        segment["updatedAt"] = now_iso()
        job = _update_job(job, status="error", evidence=segment["evidence"])
        _set_graph_status(project, route, segment)
        _save_project(project)
        _sync_project_jobs(project)
    refreshed = STUDIO_STORE.get_job(job["jobId"]) or job
    evidence = {
        **(refreshed.get("evidence") if isinstance(refreshed.get("evidence"), dict) else {}),
        **smoke_context,
    }
    refreshed = _update_job(refreshed, evidence=evidence)
    segment["evidence"] = evidence
    segment["updatedAt"] = now_iso()
    _save_project(project)
    _sync_project_jobs(project)
    return {"project": project, "job": refreshed, "segment": segment}


def _dreamy_server_page() -> dict[str, Any]:
    return {
        **get_page("dreamy-miniapp"),
        "executor": "server",
        "dispatchMode": "execute-server",
    }


def _prepare_dreamy_server_route(
    *,
    bot: dict[str, Any],
    prompt: str,
    action: str,
    source_segment_id: str | None,
    source_segment: StudioSegment | None,
    agent_id: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    route = _dreamy_bot_route(
        bot_id=str(bot.get("id") or bot.get("botId") or "").strip(),
        bot_slug=str(bot.get("slug") or bot.get("botSlug") or bot.get("id") or "").strip(),
        bot_name=str(bot.get("name") or bot.get("botName") or "").strip(),
        bot_type=str(bot.get("type") or bot.get("botType") or "").strip(),
        article_id=str(bot.get("articleId") or bot.get("article_id") or bot.get("slug") or bot.get("id") or "").strip(),
        message=prompt,
    )
    if route is None:
        raise RuntimeError("Dreamy bot route could not be resolved")
    page = _dreamy_server_page()
    route["action"] = action
    route["sourceSegmentId"] = source_segment_id
    route["sourceSummary"] = f"Using segment {source_segment_id}" if source_segment_id else "Starting from prompt"
    route["page"] = page
    route["api"] = page["id"]
    route["executor"] = page["executor"]
    route["agentId"] = _agent_id_for_dispatch(page, agent_id)
    route.update(_navigation_contract(page, route, source_segment))
    navigation_path = route.get("navigationPath", "")
    missing_route_params = _missing_route_params(page, navigation_path)
    route["routeParams"] = page.get("routeParams") or []
    route["missingRouteParams"] = missing_route_params
    return route, page, missing_route_params


async def _execute_dreamy_workshop_smoke(prompt: str, limit: int | None = None) -> dict[str, Any]:
    project = _project(None, "player")
    base_prompt = prompt.strip() or "Create a short cinematic neon city media segment for Dreamy workshop verification."
    _append_message(project, "user", base_prompt, action="generate", hasImage=False)
    selected_bots = DREAMY_BOTS[: max(1, min(limit or len(DREAMY_BOTS), len(DREAMY_BOTS)))]
    results: list[dict[str, Any]] = []
    source_segment: StudioSegment | None = None
    source_segment_id: str | None = None

    for index, bot in enumerate(selected_bots):
        bot_type = str(bot.get("type") or "")
        step_action = "extend" if bot_type == "image-to-video" and source_segment else "generate"
        step_prompt = f"{base_prompt} Step {index + 1}: {bot.get('name') or bot.get('slug')}."
        route, page, _missing = _prepare_dreamy_server_route(
            bot=bot,
            prompt=step_prompt,
            action=step_action,
            source_segment_id=source_segment_id if step_action == "extend" else None,
            source_segment=source_segment if step_action == "extend" else None,
        )
        segment = _append_queued_segment(
            project,
            route,
            route.get("optimizedPrompt") or step_prompt,
            step_action,
            route.get("sourceSegmentId"),
        )
        job = _create_job(project, segment, route, page, source_segment if step_action == "extend" else None, agent_id=route["agentId"])
        smoke_context = {
            "generationSmoke": True,
            "dreamyWorkshopSmoke": True,
            "probeId": make_id("dreamy_workshop_smoke"),
            "probeType": "dreamy-workshop-server-live",
            "botIndex": index,
            "botSlug": route["bot"]["slug"],
            "prompt": route.get("optimizedPrompt") or step_prompt,
        }
        job["evidence"] = {**(job.get("evidence") or {}), **smoke_context}
        STUDIO_STORE.save_job(job)
        STUDIO_STORE.save_evidence(job, job["evidence"])
        try:
            job = await _run_dreamy_server_adapter(
                project=project,
                segment=segment,
                job=job,
                route=route,
                prompt=route.get("optimizedPrompt") or step_prompt,
                source_segment=source_segment if step_action == "extend" else None,
            )
        except Exception as exc:
            segment["status"] = "error"
            segment["evidence"] = _evidence("error", "dreamy-miniapp", message=_exception_message(exc))
            segment["updatedAt"] = now_iso()
            job = _update_job(job, status="error", evidence=segment["evidence"])
            _set_graph_status(project, route, segment)
            _save_project(project)
            _sync_project_jobs(project)

        refreshed = STUDIO_STORE.get_job(job["jobId"]) or job
        evidence = {
            **(refreshed.get("evidence") if isinstance(refreshed.get("evidence"), dict) else {}),
            **smoke_context,
        }
        refreshed = _update_job(refreshed, evidence=evidence)
        segment["evidence"] = evidence
        segment["updatedAt"] = now_iso()
        _save_project(project)
        _sync_project_jobs(project)
        results.append(_job_with_evidence(refreshed) or refreshed)
        if segment.get("status") == "done" and (segment.get("evidence") or {}).get("accepted"):
            source_segment = segment
            source_segment_id = segment["id"]

    accepted_count = sum(1 for item in results if ((item.get("evidence") or {}).get("accepted") or item.get("status") == "done"))
    status = "done" if results and accepted_count == len(results) else "partial" if accepted_count else "error"
    return {
        "status": status,
        "project": project,
        "jobs": results,
        "count": len(results),
        "acceptedCount": accepted_count,
        "botSlugs": [str(bot.get("slug") or "") for bot in selected_bots],
    }


def _append_queued_segment(
    project: StudioProject,
    route: dict[str, Any],
    prompt: str,
    action: str,
    source_segment_id: Optional[str],
) -> StudioSegment:
    bot = route["bot"]
    segment = {
        "id": make_id("segment"),
        "type": _segment_type_for_bot({"type": bot.get("type")}),
        "url": "",
        "posterUrl": PLACEHOLDER_POSTERS.get(action, PLACEHOLDER_POSTERS["generate"]),
        "prompt": prompt,
        "botId": str(bot.get("id") or bot.get("botId") or ""),
        "articleId": str(bot.get("articleId") or bot.get("slug") or ""),
        "botSlug": bot["slug"],
        "botName": bot["name"],
        "action": action,
        "parentSegmentId": source_segment_id,
        "status": "queued",
        "taskId": "",
        "jobId": "",
        "authStatus": {},
        "evidence": _evidence(
            "queued",
            "placeholder",
            message="Placeholder poster only; waiting for real adapter output.",
        ),
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
    }
    project["segments"].append(segment)
    project["selectedSegmentId"] = segment["id"]
    project["updatedAt"] = now_iso()
    _save_project(project)
    return segment


def _event(event: str, payload: StudioEvent) -> dict[str, str]:
    payload.setdefault("type", event)
    return {"event": event, "data": json.dumps(payload, ensure_ascii=False)}


def register_studio_routes(app) -> None:
    @app.get("/api/pages")
    async def get_studio_pages():
        return {"pages": [_page_with_runtime_status(page) for page in list_studio_pages()]}

    @app.get("/api/agents")
    async def get_studio_agents():
        return {"agents": list_studio_agents()}

    @app.get("/api/studio/bot-previews")
    async def get_studio_bot_previews():
        dreamy_bots, catalog_source = await _dreamy_catalog_bots()
        response = list_bot_previews(dreamy_bots=dreamy_bots)
        response["dreamyCatalogSource"] = catalog_source
        response["dreamyCatalogReady"] = catalog_source in {"live-dreamy-explore", "live-dreamyporn-web-explore"}
        return response

    @app.post("/api/studio/dreamy-workshop-project")
    async def post_studio_dreamy_workshop_project():
        project = _verified_dreamy_workshop_project()
        _sync_project_jobs(project)
        return project

    @app.get("/api/studio/overview")
    async def get_studio_overview(limit: int = Query(50, ge=1, le=100)):
        return _studio_overview(limit=limit)

    @app.get("/api/studio/dispatch-matrix")
    async def get_studio_dispatch_matrix(
        project_id: Optional[str] = Query(None),
        source_segment_id: Optional[str] = Query(None),
    ):
        return _dispatch_matrix(project_id=project_id, source_segment_id=source_segment_id)

    @app.get("/api/studio/coverage")
    async def get_studio_coverage(
        project_id: Optional[str] = Query(None),
        source_segment_id: Optional[str] = Query(None),
    ):
        return _studio_coverage(project_id=project_id, source_segment_id=source_segment_id)

    @app.post("/api/studio/coverage/verify")
    async def post_studio_coverage_verify(payload: Optional[dict[str, Any]] = Body(None)):
        body = payload or {}
        page_ids = body.get("page_ids") or body.get("pageIds") or []
        if isinstance(page_ids, str):
            page_ids = [page_ids]
        if not isinstance(page_ids, list):
            raise HTTPException(status_code=400, detail="page_ids must be a list")
        return _verify_studio_coverage(
            project_id=body.get("project_id") or body.get("projectId"),
            source_segment_id=body.get("source_segment_id") or body.get("sourceSegmentId"),
            page_ids=[str(page_id) for page_id in page_ids],
            limit=max(1, min(int(body.get("limit") or 50), 100)),
        )

    @app.post("/api/studio/actions/resolve")
    async def post_studio_action_resolve(payload: Optional[dict[str, Any]] = Body(None)):
        return await _resolve_studio_action(payload)

    @app.post("/api/studio/actions/resolve-batch")
    async def post_studio_actions_resolve_batch(payload: Optional[dict[str, Any]] = Body(None)):
        return await _resolve_studio_actions_batch(payload)

    @app.post("/api/studio/dispatch-batch")
    async def post_studio_dispatch_batch(payload: Optional[dict[str, Any]] = Body(None)):
        body = payload or {}
        page_ids = body.get("page_ids") or body.get("pageIds") or []
        if isinstance(page_ids, str):
            page_ids = [page_ids]
        if not isinstance(page_ids, list):
            raise HTTPException(status_code=400, detail="page_ids must be a list")
        return await _studio_dispatch_batch_plan(
            project_id=body.get("project_id") or body.get("projectId"),
            source_segment_id=body.get("source_segment_id") or body.get("sourceSegmentId"),
            page_ids=[str(page_id) for page_id in page_ids],
            limit=max(1, min(int(body.get("limit") or 50), 100)),
            exclude_covered=_payload_bool(body.get("exclude_covered", body.get("excludeCovered", False))),
        )

    @app.post("/api/studio/dispatch-sessions")
    async def post_studio_dispatch_session(payload: Optional[dict[str, Any]] = Body(None)):
        body = payload or {}
        page_ids = body.get("page_ids") or body.get("pageIds") or []
        if isinstance(page_ids, str):
            page_ids = [page_ids]
        if not isinstance(page_ids, list):
            raise HTTPException(status_code=400, detail="page_ids must be a list")
        return await _create_dispatch_session(
            project_id=body.get("project_id") or body.get("projectId"),
            source_segment_id=body.get("source_segment_id") or body.get("sourceSegmentId"),
            page_ids=[str(page_id) for page_id in page_ids],
            limit=max(1, min(int(body.get("limit") or 50), 100)),
            exclude_covered=_payload_bool(body.get("exclude_covered", body.get("excludeCovered", False))),
        )

    @app.get("/api/studio/dispatch-sessions")
    async def list_studio_dispatch_sessions(
        project_id: Optional[str] = Query(None),
        limit: int = Query(20, ge=1, le=200),
    ):
        sessions = [_dispatch_session_view(session) for session in STUDIO_STORE.list_dispatch_sessions(project_id=project_id, limit=limit)]
        return {"sessions": sessions, "count": len(sessions)}

    @app.get("/api/studio/dispatch-sessions/{session_id}")
    async def get_studio_dispatch_session(
        session_id: str,
        target_id: Optional[str] = Query(None),
    ):
        return _dispatch_session_with_focused_target(_get_dispatch_session_or_404(session_id), target_id)

    @app.post("/api/studio/dispatch-sessions/{session_id}/cancel")
    async def cancel_studio_dispatch_session(session_id: str):
        return _cancel_dispatch_session(session_id)

    @app.post("/api/studio/dispatch-sessions/{session_id}/retry")
    async def retry_studio_dispatch_session(session_id: str):
        return _retry_dispatch_session(session_id)

    @app.post("/api/studio/dispatch-sessions/{session_id}/targets/{target_id}/run")
    async def run_studio_dispatch_session_target(session_id: str, target_id: str):
        return _run_dispatch_session_target(session_id, target_id)

    @app.post("/api/studio/dispatch-sessions/{session_id}/targets/{target_id}")
    async def update_studio_dispatch_session_target(session_id: str, target_id: str, payload: dict[str, Any] = Body(...)):
        evidence = payload.get("evidence") if isinstance(payload.get("evidence"), dict) else {}
        return _update_dispatch_session_target(
            session_id,
            target_id,
            status=str(payload.get("status") or ""),
            evidence=evidence,
        )

    @app.get("/api/studio/handoff-snapshot")
    async def get_studio_handoff_snapshot(
        project_id: Optional[str] = Query(None),
        source_segment_id: Optional[str] = Query(None),
    ):
        return await _studio_handoff_snapshot(project_id=project_id, source_segment_id=source_segment_id)

    @app.get("/api/studio/readiness")
    async def get_studio_readiness():
        return await _studio_readiness()

    @app.get("/api/studio/generation-smoke")
    async def get_studio_generation_smoke():
        health = await runtime_health(STUDIO_STORE.path)
        prerequisites = (health.get("components") or {}).get("liveGeneration") or {}
        latest_job = _latest_generation_smoke_job()
        return _generation_smoke_summary(prerequisites=prerequisites, latest_job=latest_job)

    @app.get("/api/studio/art-api-auth-smoke")
    async def get_studio_art_api_auth_smoke():
        cookie_source = cookie_source_status()
        if cookie_source.get("status") != "ready":
            return {
                "status": "auth_missing",
                "ready": False,
                "message": str(cookie_source.get("message") or "MyShell cookies are not configured."),
                "cookieSource": {
                    "status": cookie_source.get("status"),
                    "mode": cookie_source.get("mode"),
                    "cookieCount": cookie_source.get("cookieCount", 0),
                    "missingCookieNames": cookie_source.get("missingCookieNames", []),
                    "artApiAuthCookieStatus": cookie_source.get("artApiAuthCookieStatus", ""),
                },
            }
        probe = await myshell_art_api.probe_art_api_auth()
        return {
            **probe,
            "cookieSource": {
                "status": cookie_source.get("status"),
                "mode": cookie_source.get("mode"),
                "cookieCount": cookie_source.get("cookieCount", 0),
                "missingCookieNames": cookie_source.get("missingCookieNames", []),
                "artApiAuthCookieStatus": cookie_source.get("artApiAuthCookieStatus", ""),
            },
        }

    @app.post("/api/studio/generation-smoke")
    async def post_studio_generation_smoke(payload: Optional[dict[str, Any]] = Body(None)):
        body = payload or {}
        execute = _payload_bool(body.get("execute", False))
        prompt = str(body.get("prompt") or "").strip()
        health = await runtime_health(STUDIO_STORE.path)
        prerequisites = (health.get("components") or {}).get("liveGeneration") or {}
        latest_job = _latest_generation_smoke_job()
        if not execute:
            return _generation_smoke_summary(
                prerequisites=prerequisites,
                latest_job=latest_job,
                message="Pass execute=true to run a live Dreamy generation smoke.",
            )
        dreamy_check = ((prerequisites.get("checks") or {}).get("dreamyServer") or {}).get("status")
        if dreamy_check != "ready":
            return _generation_smoke_summary(
                prerequisites=prerequisites,
                latest_job=latest_job,
                message="Dreamy server credentials are missing; no live generation request was sent.",
            )
        executed = await _execute_generation_smoke(prompt)
        return _generation_smoke_summary(
            prerequisites=prerequisites,
            latest_job=latest_job,
            executed_job=executed["job"],
            project=executed["project"],
        )

    @app.get("/api/studio/dreamy-workshop-smoke")
    async def get_studio_dreamy_workshop_smoke():
        health = await runtime_health(STUDIO_STORE.path)
        prerequisites = (health.get("components") or {}).get("liveGeneration") or {}
        dreamy_check = ((prerequisites.get("checks") or {}).get("dreamyServer") or {}).get("status")
        return {
            "status": "ready" if dreamy_check == "ready" else "needs_configuration",
            "ready": dreamy_check == "ready",
            "endpoint": "/api/studio/dreamy-workshop-smoke",
            "message": (
                "Pass execute=true to run every Dreamy workshop bot from backend credentials."
                if dreamy_check == "ready"
                else "Dreamy server credentials are missing; no live generation request will be sent."
            ),
            "bots": [
                {
                    "slug": bot.get("slug"),
                    "name": bot.get("name"),
                    "type": bot.get("type"),
                    "pageId": bot.get("pageId"),
                }
                for bot in DREAMY_BOTS
            ],
            "count": len(DREAMY_BOTS),
            "prerequisites": prerequisites,
        }

    @app.post("/api/studio/dreamy-workshop-smoke")
    async def post_studio_dreamy_workshop_smoke(payload: Optional[dict[str, Any]] = Body(None)):
        body = payload or {}
        execute = _payload_bool(body.get("execute", False))
        prompt = str(body.get("prompt") or "").strip()
        limit_value = body.get("limit")
        try:
            limit = int(limit_value) if limit_value is not None else len(DREAMY_BOTS)
        except (TypeError, ValueError):
            limit = len(DREAMY_BOTS)
        limit = max(1, min(limit, len(DREAMY_BOTS)))
        health = await runtime_health(STUDIO_STORE.path)
        prerequisites = (health.get("components") or {}).get("liveGeneration") or {}
        dreamy_check = ((prerequisites.get("checks") or {}).get("dreamyServer") or {}).get("status")
        if not execute:
            return {
                "status": "ready" if dreamy_check == "ready" else "needs_configuration",
                "ready": dreamy_check == "ready",
                "message": "Pass execute=true to run every Dreamy workshop bot.",
                "count": limit,
                "prerequisites": prerequisites,
            }
        if dreamy_check != "ready":
            return {
                "status": "needs_configuration",
                "ready": False,
                "message": "Dreamy server credentials are missing; no live generation request was sent.",
                "count": 0,
                "acceptedCount": 0,
                "bots": [],
                "prerequisites": prerequisites,
            }
        executed = await _execute_dreamy_workshop_smoke(prompt, limit=limit)
        return {
            **executed,
            "ready": executed["status"] == "done",
            "prerequisites": prerequisites,
        }

    @app.get("/api/studio/delivery-audit")
    async def get_studio_delivery_audit(
        project_id: Optional[str] = Query(None),
        source_segment_id: Optional[str] = Query(None),
        download: bool = Query(False),
    ):
        audit = await _studio_delivery_audit(project_id=project_id, source_segment_id=source_segment_id)
        if download:
            audit_project_id = audit.get("projectId") or project_id or "current"
            return JSONResponse(
                audit,
                headers={
                    "Content-Disposition": f'attachment; filename="myshell-studio-audit-{audit_project_id}.json"',
                },
            )
        return audit

    @app.get("/api/studio/dispatch-preview")
    async def get_dispatch_preview(
        message: str = Query(""),
        project_id: Optional[str] = Query(None),
        action: str = Query("generate"),
        source_segment_id: Optional[str] = Query(None),
        page_id: str = Query("dreamy-miniapp"),
        agent_id: Optional[str] = Query(None),
        has_image: bool = Query(False),
        bot_id: Optional[str] = Query(None),
        bot_slug: Optional[str] = Query(None),
        bot_name: Optional[str] = Query(None),
        bot_type: Optional[str] = Query(None),
        article_id: Optional[str] = Query(None),
    ):
        return await _dispatch_preview(
            message=message,
            action=action,
            page_id=page_id,
            agent_id=agent_id,
            project_id=project_id,
            source_segment_id=source_segment_id,
            has_image=has_image,
            bot_id=bot_id,
            bot_slug=bot_slug,
            bot_name=bot_name,
            bot_type=bot_type,
            article_id=article_id,
        )

    @app.post("/api/studio/run")
    async def run_studio(
        message: str = Form(""),
        project_id: Optional[str] = Form(None),
        mode: str = Form("player"),
        action: str = Form("generate"),
        source_segment_id: Optional[str] = Form(None),
        page_id: str = Form("dreamy-miniapp"),
        agent_id: Optional[str] = Form(None),
        bot_id: Optional[str] = Form(None),
        bot_slug: Optional[str] = Form(None),
        bot_name: Optional[str] = Form(None),
        bot_type: Optional[str] = Form(None),
        article_id: Optional[str] = Form(None),
        bot_sequence: Optional[str] = Form(None),
        agent_graph: Optional[str] = Form(None),
        image: Optional[UploadFile] = File(None),
    ):
        normalized_mode = _normalize_mode(mode)
        normalized_action = _normalize_action(action)
        prompt = message.strip() or {
            "generate": "Create a new Dreamy media segment.",
            "extend": "Extend the selected video with a natural next shot.",
            "restyle": "Restyle the selected segment while keeping the subject consistent.",
            "retry-agent": "Try another agent for the selected segment.",
        }[normalized_action]

        project = _project(project_id, normalized_mode)
        if agent_graph:
            try:
                parsed_graph = json.loads(agent_graph)
                if isinstance(parsed_graph, list):
                    project["agentGraph"] = parsed_graph
            except json.JSONDecodeError:
                pass

        image_data = None
        image_bytes: bytes | None = None
        image_filename = ""
        image_content_type = ""
        if image is not None:
            image_bytes = await image.read()
            image_data = base64.b64encode(image_bytes).decode()
            image_filename = image.filename or "studio-source.jpg"
            image_content_type = image.content_type or _guess_image_content_type(image_filename)
        has_image = image_data is not None
        source_segment = _resolve_source_segment(project, source_segment_id)
        resolved_source_segment_id = source_segment.get("id") if source_segment else source_segment_id
        manual_bot_sequence = _manual_bot_sequence_items(bot_sequence, normalized_action)
        _append_message(
            project,
            "user",
            prompt,
            action=normalized_action,
            sourceSegmentId=resolved_source_segment_id,
            hasImage=has_image,
        )

        async def event_generator():
            yield _event(
                "meta",
                {
                    "projectId": project["projectId"],
                    "conversationId": project["conversationId"],
                    "mode": normalized_mode,
                },
            )

            if manual_bot_sequence:
                yield _event(
                    "progress",
                    {
                        "step": "manual-bot-sequence",
                        "message": f"Queueing {len(manual_bot_sequence)} manual Dreamy bot steps",
                        "progress": 18,
                    },
                )
                sequence_source_segment = source_segment
                sequence_source_segment_id = resolved_source_segment_id
                last_segment: StudioSegment | None = None
                last_job: dict[str, Any] | None = None
                for index, manual_bot in enumerate(manual_bot_sequence):
                    step_prompt = manual_bot.get("prompt") or prompt
                    step_action = manual_bot.get("action") or ("extend" if index else normalized_action)
                    route = _dreamy_bot_route(
                        bot_id=manual_bot.get("botId"),
                        bot_slug=manual_bot.get("botSlug"),
                        bot_name=manual_bot.get("botName"),
                        bot_type=manual_bot.get("botType"),
                        article_id=manual_bot.get("articleId"),
                        message=step_prompt,
                    )
                    if route is None:
                        continue
                    page = page_for_dispatch(route["bot"], page_id, step_prompt)
                    if page["id"] == "dreamy-miniapp" and adapter_auth_status("dreamy-miniapp").get("status") == "ready":
                        page = {
                            **page,
                            "executor": "server",
                            "dispatchMode": "execute-server",
                        }
                    route["action"] = step_action
                    route["sourceSegmentId"] = sequence_source_segment_id
                    route["sourceSummary"] = (
                        f"Using segment {sequence_source_segment_id}" if sequence_source_segment_id else "Starting from prompt"
                    )
                    route["page"] = page
                    route["api"] = page["id"]
                    route["executor"] = page["executor"]
                    route["agentId"] = _agent_id_for_dispatch(page, agent_id)
                    route.update(_navigation_contract(page, route, sequence_source_segment))
                    navigation_path = route.get("navigationPath", "")
                    missing_route_params = _missing_route_params(page, navigation_path)
                    route["routeParams"] = page.get("routeParams") or []
                    route["missingRouteParams"] = missing_route_params
                    yield _event("route", route)
                    yield _event(
                        "progress",
                        {
                            "step": "manual-bot-sequence",
                            "message": f"Queued manual bot {index + 1}/{len(manual_bot_sequence)}",
                            "progress": min(85, 25 + index * 10),
                        },
                    )

                    segment = _append_queued_segment(
                        project,
                        route,
                        route.get("optimizedPrompt") or step_prompt,
                        step_action,
                        sequence_source_segment_id,
                    )
                    job = _create_job(project, segment, route, page, sequence_source_segment, agent_id=route["agentId"])
                    graph = _set_graph_status(project, route, segment)
                    _append_message(
                        project,
                        "assistant",
                        f"Queued {route['bot']['name']} as manual sequence step {index + 1}/{len(manual_bot_sequence)}.",
                        route=route,
                        segmentId=segment["id"],
                        jobId=job["jobId"],
                    )
                    yield _event(
                        "execution_request",
                        {
                            "executor": route["executor"],
                            "api": page["id"],
                            "page": page,
                            "agentId": job["agentId"],
                            **_navigation_contract(page, route, sequence_source_segment),
                            "routeParams": page.get("routeParams") or [],
                            "missingRouteParams": missing_route_params,
                            "jobId": job["jobId"],
                            "segmentId": segment["id"],
                            "botId": route["bot"].get("id") or "",
                            "articleId": route["bot"].get("articleId") or "",
                            "botSlug": route["bot"]["slug"],
                            "botName": route["bot"]["name"],
                            "botType": route["bot"]["type"],
                            "prompt": route.get("optimizedPrompt") or step_prompt,
                            "action": step_action,
                            "sourceSegment": sequence_source_segment,
                            "agentGraph": graph,
                            "segment": segment,
                            "authStatus": job["authStatus"],
                            "evidence": job["evidence"],
                        },
                    )
                    yield _event("job", {"job": job})
                    if page["id"] == "dreamy-miniapp" and page["executor"] == "server":
                        yield _event(
                            "progress",
                            {
                                "step": "manual-bot-sequence",
                                "message": f"Running Dreamy bot {index + 1}/{len(manual_bot_sequence)} from the Studio backend",
                                "progress": min(95, 35 + index * 10),
                            },
                        )
                        try:
                            job = await _run_dreamy_server_adapter(
                                project=project,
                                segment=segment,
                                job=job,
                                route=route,
                                prompt=route.get("optimizedPrompt") or step_prompt,
                                source_segment=sequence_source_segment,
                                input_image_bytes=image_bytes if index == 0 else None,
                                input_image_filename=image_filename,
                                input_image_content_type=image_content_type,
                            )
                        except Exception as exc:
                            segment["status"] = "error"
                            segment["evidence"] = _evidence("error", "dreamy-miniapp", message=_exception_message(exc))
                            segment["updatedAt"] = now_iso()
                            job = _update_job(job, status="error", evidence=segment["evidence"])
                            _set_graph_status(project, route, segment)
                            _save_project(project)
                            _sync_project_jobs(project)
                        job = STUDIO_STORE.get_job(job["jobId"]) or job
                        yield _event("job", {"job": job})
                    sequence_source_segment = segment
                    sequence_source_segment_id = segment["id"]
                    last_segment = segment
                    last_job = job

                yield _event("project", {"project": project})
                yield _event(
                    "done",
                    {
                        "status": (last_segment or {}).get("status", "queued"),
                        "projectId": project["projectId"],
                        "segmentId": (last_segment or {}).get("id"),
                        "jobId": (last_job or {}).get("jobId"),
                    },
                )
                return

            route = (
                _dreamy_bot_route(
                    bot_id=bot_id,
                    bot_slug=bot_slug,
                    bot_name=bot_name,
                    bot_type=bot_type,
                    article_id=article_id,
                    message=prompt,
                )
                if page_id == "dreamy-miniapp" and (bot_slug or bot_id)
                else None
            )
            if route is None:
                route = await choose_route(prompt, has_image, normalized_action, source_segment)
            page = page_for_dispatch(route["bot"], page_id, prompt)
            if page["id"] == "dreamy-miniapp" and adapter_auth_status("dreamy-miniapp").get("status") == "ready":
                page = {
                    **page,
                    "executor": "server",
                    "dispatchMode": "execute-server",
                }
            route["action"] = normalized_action
            route["sourceSegmentId"] = resolved_source_segment_id
            route["sourceSummary"] = (
                f"Using segment {resolved_source_segment_id}" if resolved_source_segment_id else "Starting from prompt"
            )
            route["page"] = page
            route["api"] = page["id"]
            route["executor"] = page["executor"]
            route["agentId"] = _agent_id_for_dispatch(page, agent_id)
            route.update(_navigation_contract(page, route, source_segment))
            navigation_path = route.get("navigationPath", "")
            missing_route_params = _missing_route_params(page, navigation_path)
            route["routeParams"] = page.get("routeParams") or []
            route["missingRouteParams"] = missing_route_params
            yield _event("route", route)

            yield _event(
                "progress",
                {
                    "step": "planning",
                    "message": "Preparing Studio dispatch request",
                    "progress": 20,
                },
            )

            segment = _append_queued_segment(
                project,
                route,
                route.get("optimizedPrompt") or prompt,
                normalized_action,
                resolved_source_segment_id,
            )
            job = _create_job(project, segment, route, page, source_segment, agent_id=route["agentId"])
            graph = _set_graph_status(project, route, segment)
            _append_message(
                project,
                "assistant",
                (
                    f"Queued {page['name']} navigation dispatch."
                    if page["executor"] == "navigation"
                    else f"Queued {route['bot']['name']} for {normalized_action}."
                ),
                route=route,
                segmentId=segment["id"],
                jobId=job["jobId"],
            )

            yield _event(
                "execution_request",
                {
                    "executor": route["executor"],
                    "api": page["id"],
                    "page": page,
                    "agentId": job["agentId"],
                    **_navigation_contract(page, route, source_segment),
                    "routeParams": page.get("routeParams") or [],
                    "missingRouteParams": missing_route_params,
                    "jobId": job["jobId"],
                    "segmentId": segment["id"],
                    "botId": route["bot"].get("id") or "",
                    "articleId": route["bot"].get("articleId") or "",
                    "botSlug": route["bot"]["slug"],
                    "botName": route["bot"]["name"],
                    "botType": route["bot"]["type"],
                    "prompt": route.get("optimizedPrompt") or prompt,
                    "action": normalized_action,
                    "sourceSegment": source_segment,
                    "agentGraph": graph,
                    "segment": segment,
                    "authStatus": job["authStatus"],
                    "evidence": job["evidence"],
                },
            )
            yield _event("job", {"job": job})

            if page["id"] == "dreamy-miniapp" and page["executor"] == "server":
                yield _event(
                    "progress",
                    {
                        "step": "dreamy-server",
                        "message": "Running Dreamy generation from the Studio backend",
                        "progress": 45,
                    },
                )
                try:
                    job = await _run_dreamy_server_adapter(
                        project=project,
                        segment=segment,
                        job=job,
                        route=route,
                        prompt=route.get("optimizedPrompt") or prompt,
                        source_segment=source_segment,
                        input_image_bytes=image_bytes,
                        input_image_filename=image_filename,
                        input_image_content_type=image_content_type,
                    )
                except Exception as exc:
                    segment["status"] = "error"
                    segment["evidence"] = _evidence("error", "dreamy-miniapp", message=_exception_message(exc))
                    segment["updatedAt"] = now_iso()
                    job = _update_job(job, status="error", evidence=segment["evidence"])
                    _set_graph_status(project, route, segment)
                    _save_project(project)
                    _sync_project_jobs(project)
                yield _event("job", {"job": STUDIO_STORE.get_job(job["jobId"])})

            if page["executor"] == "navigation":
                if missing_route_params:
                    segment["status"] = "error"
                    segment["evidence"] = _evidence(
                        "error",
                        page["id"],
                        accepted=False,
                        message=f"Missing route parameters: {', '.join(missing_route_params)}.",
                    )
                    segment["evidence"].update(
                        {
                            "pageId": page["id"],
                            "agentId": job["agentId"],
                            "navigationPath": navigation_path,
                            "missingRouteParams": missing_route_params,
                        }
                    )
                else:
                    segment["status"] = "done"
                    segment["evidence"] = _evidence(
                        "done",
                        page["id"],
                        accepted=True,
                        message=f"Navigation dispatch prepared for {page['name']} at {navigation_path}.",
                    )
                    segment["evidence"].update(
                        {
                            "pageId": page["id"],
                            "agentId": job["agentId"],
                            "navigationPath": navigation_path,
                            "missingRouteParams": [],
                        }
                    )
                segment["updatedAt"] = now_iso()
                _update_job(
                    job,
                    status=segment["status"],
                    evidence=segment["evidence"],
                    authStatus=adapter_auth_status(page["id"]),
                )
                _set_graph_status(project, route, segment)
                _save_project(project)
                _sync_project_jobs(project)
                yield _event("job", {"job": STUDIO_STORE.get_job(job["jobId"])})

            if page["id"] == "myshell-art":
                auth_status = adapter_auth_status(page["id"])
                if auth_status["status"] == "auth_missing":
                    segment["status"] = "auth_missing"
                    segment["authStatus"] = auth_status
                    auth_message = str(
                        auth_status.get("message")
                        or "MyShell Art authentication is missing; no generation was attempted."
                    )
                    segment["evidence"] = _evidence(
                        "auth_missing",
                        "myshell-art",
                        message=f"{auth_message}; no generation was attempted.",
                    )
                    segment["updatedAt"] = now_iso()
                    _update_job(
                        job,
                        status="auth_missing",
                        authStatus=auth_status,
                        evidence=segment["evidence"],
                    )
                    _set_graph_status(project, route, segment)
                    _save_project(project)
                    _sync_project_jobs(project)
                    yield _event("job", {"job": STUDIO_STORE.get_job(job["jobId"])})
                elif route["bot"]["type"] in {"image-to-image", "image-to-video"} and not image_data:
                    segment["status"] = "error"
                    segment["evidence"] = _evidence(
                        "error",
                        "myshell-art",
                        message="This MyShell Art bot requires an uploaded source image.",
                    )
                    segment["updatedAt"] = now_iso()
                    _update_job(job, status="error", evidence=segment["evidence"])
                    _set_graph_status(project, route, segment)
                    _save_project(project)
                    _sync_project_jobs(project)
                    yield _event("job", {"job": STUDIO_STORE.get_job(job["jobId"])})
                else:
                    segment["status"] = "running"
                    segment["updatedAt"] = now_iso()
                    _update_job(job, status="running")
                    _save_project(project)
                    _sync_project_jobs(project)
                    yield _event(
                        "progress",
                        {
                            "step": "myshell-art",
                            "message": "Running MyShell Art through the CDP bridge",
                            "progress": 45,
                        },
                    )
                    try:
                        from myshell_bridge import generate_via_bot

                        result = await generate_via_bot(
                            bot_slug=route["bot"]["slug"],
                            prompt=route.get("optimizedPrompt") or prompt,
                            gen_button=(get_bot_by_slug(route["bot"]["slug"]) or {}).get("gen_button", ""),
                            image_data=image_data,
                        )
                        if result.get("status") == "done" and result.get("output_url"):
                            segment["status"] = "done"
                            segment["url"] = result["output_url"]
                            segment["posterUrl"] = result["output_url"]
                            segment["evidence"] = _evidence(
                                "done",
                                "myshell-art",
                                accepted=True,
                                media_url=result["output_url"],
                                message="Fresh output URL extracted after generation.",
                            )
                            _update_job(
                                job,
                                status="done",
                                mediaUrl=result["output_url"],
                                posterUrl=result["output_url"],
                                evidence=segment["evidence"],
                            )
                        else:
                            error_message = result.get("message", "MyShell Art generation did not return output media.")
                            status = "timeout" if "timed out" in error_message.lower() else "error"
                            segment["status"] = status
                            segment["evidence"] = _evidence(status, "myshell-art", message=error_message)
                            _update_job(job, status=status, evidence=segment["evidence"])
                    except Exception as exc:
                        segment["status"] = "error"
                        segment["evidence"] = _evidence("error", "myshell-art", message=_exception_message(exc))
                        _update_job(job, status="error", evidence=segment["evidence"])
                    segment["updatedAt"] = now_iso()
                    _set_graph_status(project, route, segment)
                    _save_project(project)
                    _sync_project_jobs(project)
                    yield _event("job", {"job": STUDIO_STORE.get_job(job["jobId"])})

            yield _event(
                "project",
                {
                    "project": project,
                },
            )

            yield _event(
                "done",
                {
                    "status": segment.get("status", "queued"),
                    "projectId": project["projectId"],
                    "segmentId": segment["id"],
                    "jobId": job["jobId"],
                },
            )

        return EventSourceResponse(event_generator(), ping=15)

    @app.get("/api/studio/projects")
    async def list_studio_projects(limit: int = Query(50, ge=1, le=200)):
        projects = STUDIO_STORE.list_projects(limit=limit)
        for project in projects:
            project["jobs"] = [_job_with_evidence(job) for job in STUDIO_STORE.list_jobs(project["projectId"])]
        return {"projects": projects, "count": len(projects)}

    @app.get("/api/studio/projects/{project_id}")
    async def get_studio_project(project_id: str):
        project = _get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        _sync_project_jobs(project)
        return project

    @app.get("/api/studio/projects/{project_id}/delivery-report")
    async def get_studio_project_delivery_report(project_id: str):
        project = _get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        return _project_delivery_report(project)

    @app.get("/api/studio/projects/{project_id}/delivery-bundle")
    async def get_studio_project_delivery_bundle(
        project_id: str,
        source_segment_id: Optional[str] = Query(None),
        download: bool = Query(False),
    ):
        project = _get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        bundle = await _project_delivery_bundle(project, source_segment_id=source_segment_id)
        if download:
            return JSONResponse(
                bundle,
                headers={
                    "Content-Disposition": f'attachment; filename="myshell-studio-delivery-{project_id}.json"',
                },
            )
        return bundle

    @app.get("/api/studio/projects/{project_id}/timeline-exports")
    async def list_studio_timeline_exports(project_id: str):
        project = _get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        exports = project.get("timelineExports") or []
        return {"projectId": project_id, "exports": exports, "count": len(exports)}

    @app.post("/api/studio/projects/{project_id}/timeline-export")
    async def create_studio_timeline_export(project_id: str, payload: dict[str, Any] = Body(default_factory=dict)):
        project = _get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        segment_ids = payload.get("segmentIds") if isinstance(payload, dict) else None
        if segment_ids is not None and not isinstance(segment_ids, list):
            raise HTTPException(status_code=400, detail="segmentIds must be a list")
        return _create_timeline_export(project, segment_ids=[str(item) for item in segment_ids] if segment_ids else None)

    @app.post("/api/studio/projects/{project_id}/client-result")
    async def post_studio_client_result(project_id: str, payload: dict[str, Any] = Body(...)):
        project = _get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        segment_id = payload.get("segmentId") or payload.get("id")
        segment = _find_segment(project, segment_id)
        if not segment:
            route_bot_slug = payload.get("botSlug") or "seedream-multi-chart"
            bot = get_dreamy_bot_by_slug(route_bot_slug) or get_bot_by_slug(route_bot_slug) or {
                "slug": route_bot_slug,
                "name": payload.get("botName") or route_bot_slug,
                "type": payload.get("type") or "text-to-image",
            }
            segment = {
                "id": segment_id or make_id("segment"),
                "type": payload.get("type") or _segment_type_for_bot(bot),
                "url": "",
                "posterUrl": "",
                "prompt": payload.get("prompt") or "",
                "botId": payload.get("botId") or "",
                "articleId": payload.get("articleId") or route_bot_slug,
                "botSlug": bot["slug"],
                "botName": bot["name"],
                "action": payload.get("action") or "generate",
                "parentSegmentId": payload.get("parentSegmentId"),
                "status": "running",
                "taskId": "",
                "jobId": payload.get("jobId", ""),
                "authStatus": payload.get("authStatus") or adapter_auth_status("dreamy-miniapp"),
                "evidence": {},
                "createdAt": now_iso(),
                "updatedAt": now_iso(),
            }
            project["segments"].append(segment)

        normalized_status = _normalize_status(payload.get("status"))
        if normalized_status == "done" and not payload.get("url"):
            normalized_status = "error"
            payload = {
                **payload,
                "status": "error",
                "evidence": _evidence(
                    "error",
                    payload.get("source") or "dreamy-miniapp",
                    message="Done status rejected because no media URL was supplied.",
                ),
            }

        for key in (
            "type",
            "url",
            "posterUrl",
            "prompt",
            "botId",
            "articleId",
            "botSlug",
            "botName",
            "action",
            "parentSegmentId",
            "status",
            "taskId",
            "jobId",
            "authStatus",
            "evidence",
        ):
            if key in payload and payload[key] is not None:
                segment[key] = payload[key]
        segment["status"] = normalized_status
        if "evidence" not in payload:
            segment["evidence"] = _evidence(
                normalized_status,
                payload.get("source") or "dreamy-miniapp",
                accepted=normalized_status == "done" and bool(segment.get("url")),
                media_url=segment.get("url") or "",
                task_id=segment.get("taskId") or "",
                message=(
                    "Fresh Dreamy task media accepted."
                    if normalized_status == "done" and segment.get("url")
                    else "Client result registered; waiting for final media."
                ),
            )
        segment.setdefault("authStatus", adapter_auth_status("dreamy-miniapp"))
        segment["updatedAt"] = now_iso()
        project["selectedSegmentId"] = segment["id"]
        project["updatedAt"] = now_iso()
        _set_graph_status(
            project,
            {
                "bot": {
                    "slug": segment.get("botSlug"),
                    "name": segment.get("botName"),
                    "type": segment.get("type"),
                },
                "executor": "client",
                "analysis": "Client result registered.",
                "sourceSummary": "Timeline updated.",
            },
            segment,
        )
        _append_message(
            project,
            "assistant",
            f"Segment {segment['id']} is {segment.get('status', 'updated')}.",
            segmentId=segment["id"],
        )
        job = None
        job_id = segment.get("jobId") or payload.get("jobId")
        if job_id:
            job = STUDIO_STORE.get_job(job_id)
        if not job:
            job = STUDIO_STORE.find_job_by_segment(project_id, segment["id"])
        if job:
            segment["jobId"] = job["jobId"]
            job = _update_job(
                job,
                status=normalized_status,
                botId=segment.get("botId") or job.get("botId"),
                articleId=segment.get("articleId") or job.get("articleId"),
                taskId=segment.get("taskId") or job.get("taskId"),
                mediaUrl=segment.get("url") or job.get("mediaUrl"),
                posterUrl=segment.get("posterUrl") or job.get("posterUrl"),
                evidence=segment.get("evidence"),
                authStatus=segment.get("authStatus"),
            )
        dispatch_session_id = payload.get("dispatchSessionId") or ((job or {}).get("evidence") or {}).get("dispatchSessionId")
        dispatch_target_id = payload.get("dispatchTargetId") or ((job or {}).get("evidence") or {}).get("dispatchTargetId")
        if dispatch_session_id and dispatch_target_id and normalized_status in {"done", "error", "timeout", "auth_missing"}:
            target_status = "completed" if normalized_status == "done" and (segment.get("evidence") or {}).get("accepted") else "error"
            _update_dispatch_session_target(
                str(dispatch_session_id),
                str(dispatch_target_id),
                status=target_status,
                evidence={
                    "dispatchSessionId": str(dispatch_session_id),
                    "dispatchTargetId": str(dispatch_target_id),
                    "jobId": segment.get("jobId") or "",
                    "segmentId": segment.get("id") or "",
                    "accepted": bool((segment.get("evidence") or {}).get("accepted")),
                    "mediaUrl": segment.get("url") or "",
                    "posterUrl": segment.get("posterUrl") or "",
                    "taskId": segment.get("taskId") or "",
                    "message": (segment.get("evidence") or {}).get("message") or "",
                },
            )
        _sync_project_jobs(project)
        return {"project": project, "segment": segment, "job": job}

    @app.post("/api/studio/projects/{project_id}/reset")
    async def reset_studio_project(project_id: str):
        if project_id in PROJECTS:
            del PROJECTS[project_id]
        STUDIO_STORE.delete_project(project_id)
        return {"projectId": project_id, "status": "reset"}

    @app.get("/api/studio/jobs")
    async def list_studio_jobs(
        project_id: Optional[str] = Query(None),
        status: Optional[str] = Query(None),
        page_id: Optional[str] = Query(None),
        agent_id: Optional[str] = Query(None),
        limit: int = Query(100, ge=1, le=500),
    ):
        jobs = STUDIO_STORE.list_jobs(
            project_id=project_id,
            status=status,
            page_id=page_id,
            agent_id=agent_id,
            limit=limit,
        )
        return {"jobs": [_job_with_evidence(job) for job in jobs], "count": len(jobs)}

    @app.post("/api/studio/jobs/bulk")
    async def bulk_studio_jobs(payload: dict[str, Any] = Body(...)):
        action = str(payload.get("action") or "").strip()
        if action not in {"cancel", "retry"}:
            raise HTTPException(status_code=400, detail="Bulk action must be cancel or retry")
        jobs = STUDIO_STORE.list_jobs(
            project_id=payload.get("project_id"),
            status=payload.get("status"),
            page_id=payload.get("page_id"),
            agent_id=payload.get("agent_id"),
            limit=int(payload.get("limit") or 100),
        )
        include_terminal = bool(payload.get("include_terminal"))
        updated_jobs: list[dict[str, Any]] = []
        skipped_jobs: list[dict[str, Any]] = []
        projects_by_id: dict[str, StudioProject] = {}
        execution_requests: list[dict[str, Any]] = []
        for job in jobs:
            if action == "cancel" and not include_terminal and job.get("status") in TERMINAL_CANCEL_STATUSES:
                skipped_jobs.append(_job_with_evidence(job))
                continue
            if action == "cancel":
                updated_job, project = _cancel_job_record(job)
                execution_request = None
            else:
                updated_job, project, execution_request = _retry_job_record(job)
            updated_jobs.append(_job_with_evidence(updated_job))
            if project:
                projects_by_id[project["projectId"]] = project
            if execution_request:
                execution_requests.append(execution_request)
        return {
            "action": action,
            "matchedCount": len(updated_jobs),
            "skippedCount": len(skipped_jobs),
            "jobs": updated_jobs,
            "skippedJobs": skipped_jobs,
            "projects": list(projects_by_id.values()),
            "executionRequests": execution_requests,
        }

    @app.get("/api/studio/jobs/{job_id}/evidence")
    async def get_studio_job_evidence(job_id: str):
        job = STUDIO_STORE.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        return {"jobId": job_id, "evidence": STUDIO_STORE.list_evidence(job_id=job_id)}

    @app.get("/api/studio/jobs/{job_id}")
    async def get_studio_job(job_id: str):
        job = STUDIO_STORE.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        return _job_with_evidence(job)

    @app.post("/api/studio/jobs/{job_id}/cancel")
    async def cancel_studio_job(job_id: str):
        job = STUDIO_STORE.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        job, project = _cancel_job_record(job)
        return {"job": _job_with_evidence(job), "project": project}

    @app.post("/api/studio/jobs/{job_id}/retry")
    async def retry_studio_job(job_id: str):
        job = STUDIO_STORE.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        job, project, execution_request = _retry_job_record(job)
        return {"job": _job_with_evidence(job), "project": project, "executionRequest": execution_request}

    @app.post("/api/studio/jobs/{job_id}/poll")
    async def poll_studio_job(job_id: str):
        job = STUDIO_STORE.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        job, project = await _poll_dreamy_job_result(job)
        return {"job": _job_with_evidence(job), "project": project}
