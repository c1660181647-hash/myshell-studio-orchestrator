from __future__ import annotations

import json
import os
import uuid
import base64
from datetime import UTC, datetime
from typing import Any, Optional
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

from fastapi import Body, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse

from bot_catalog import MYSHELL_BOTS, get_bot_by_slug
from studio_registry import get_page, list_studio_agents, list_studio_pages, page_for_dispatch
from studio_runtime import adapter_auth_status, runtime_health
from studio_store import STUDIO_STORE

try:
    from orchestrator import understand_intent
except Exception:  # pragma: no cover - keeps tests independent of optional AI deps
    understand_intent = None


StudioProject = dict[str, Any]
StudioSegment = dict[str, Any]
StudioEvent = dict[str, Any]

PROJECTS: dict[str, StudioProject] = {}

VALID_MODES = {"player", "canvas"}
VALID_ACTIONS = {"generate", "extend", "restyle", "retry-agent"}
VALID_STATUSES = {"draft", "queued", "running", "done", "timeout", "auth_missing", "error", "cancelled"}
VALID_DISPATCH_TARGET_STATUSES = {"pending", "visited", "completed", "skipped", "error"}
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
    return {
        **page,
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
        "executor": page.get("executor", ""),
        "agentId": _agent_id_for_page(page),
        "recommendedAction": _recommended_action_for_page(page),
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
) -> dict[str, Any]:
    if project_id and not _get_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")

    matrix = _dispatch_matrix(project_id=project_id, source_segment_id=source_segment_id)
    requested_page_ids = {page_id for page_id in (page_ids or []) if page_id}
    max_targets = max(1, min(limit, 100))
    selected_entries = [
        entry for entry in matrix.get("entries", []) if not requested_page_ids or entry.get("pageId") in requested_page_ids
    ]
    targets: list[dict[str, Any]] = []
    skipped_targets: list[dict[str, Any]] = []

    for entry in selected_entries:
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
    summary = dict(session.get("summary") or {})
    summary.update(
        {
            "pending": pending,
            "visited": visited,
            "completed": completed,
            "targetSkipped": skipped_targets,
            "targetErrors": errors,
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
    view["nextTarget"] = _dispatch_session_next_target(targets)
    return view


async def _create_dispatch_session(
    *,
    project_id: str | None = None,
    source_segment_id: str | None = None,
    page_ids: list[str] | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    plan = await _studio_dispatch_batch_plan(
        project_id=project_id,
        source_segment_id=source_segment_id,
        page_ids=page_ids,
        limit=limit,
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
    if evidence:
        target["evidence"] = evidence
    if status == "completed":
        _record_dispatch_session_target_completion(session, target, evidence or {})

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
    return gaps, actions


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
    gaps, actions = _handoff_gaps_and_actions(coverage, delivery_report)
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
    if status == "auth_missing" or "auth" in requirement_id or "cookie" in requirement_id:
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
    if handoff and isinstance(handoff.get("actions"), list):
        return list(handoff.get("actions") or [])
    actions: list[dict[str, Any]] = []
    for requirement in requirements:
        action = _audit_action_for_requirement(requirement)
        if action:
            actions.append(action)
    return actions


async def _studio_readiness() -> dict[str, Any]:
    health = await runtime_health(STUDIO_STORE.path)
    components = health.get("components") or {}
    pages = list_studio_pages()
    agents = list_studio_agents()
    page_ids = {page["id"] for page in pages}
    agent_ids = {agent["id"] for agent in agents}
    missing_page_ids = sorted(CORE_DELIVERY_PAGE_IDS - page_ids)
    missing_agent_ids = sorted(CORE_DELIVERY_AGENT_IDS - agent_ids)

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
            "ready" if not missing_page_ids else "blocked",
            message=f"{len(pages)} registered MyShell pages",
            evidence={"pageCount": len(pages), "missingPageIds": missing_page_ids},
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
                "degraded",
                required=False,
                message="Pass project_id to audit project delivery evidence.",
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
        },
    }


def _manual_action_instruction(action: str, target_id: str) -> dict[str, Any]:
    if action == "restore-auth":
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
        return {
            "label": "Inspect handoff gap",
            "message": "Inspect the handoff snapshot gap and related coverage evidence before retrying the target.",
            "endpoint": "/api/studio/handoff-snapshot",
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


async def _resolve_studio_action(payload: dict[str, Any] | None) -> dict[str, Any]:
    body = payload or {}
    action = str(body.get("action") or "").strip()
    target_id = str(body.get("target_id") or body.get("targetId") or "").strip()
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

    if action in MANUAL_STUDIO_ACTIONS:
        audit = await _studio_delivery_audit(project_id=project_id, source_segment_id=source_segment_id)
        return {
            "status": "manual_required",
            "checkedAt": now_iso(),
            "action": action,
            "targetId": target_id,
            "projectId": project_id,
            "sourceSegmentId": source_segment_id,
            "resultType": "operator-instruction",
            "message": "Manual operator action is required.",
            "next": _manual_action_instruction(action, target_id),
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
        if not action or not target_id:
            raise HTTPException(status_code=400, detail="Each action requires action and target_id")
        normalized_actions.append({"action": action, "targetId": target_id, "raw": item})

    verify_page_ids = []
    manual_actions: list[dict[str, Any]] = []
    skipped_actions: list[dict[str, Any]] = []
    for item in normalized_actions:
        action = item["action"]
        target_id = item["targetId"]
        if action == "verify-ready":
            verify_page_ids.append(target_id)
        elif action in MANUAL_STUDIO_ACTIONS:
            manual_actions.append(
                {
                    "status": "manual_required",
                    "action": action,
                    "targetId": target_id,
                    "resultType": "operator-instruction",
                    "message": "Manual operator action is required.",
                    "next": _manual_action_instruction(action, target_id),
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
            "createdJobs": int((coverage_result or {}).get("createdCount") or 0),
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


def _sync_project_jobs(project: StudioProject) -> None:
    project["jobs"] = [_job_with_evidence(job) for job in STUDIO_STORE.list_jobs(project["projectId"])]
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
    skipped_targets = [target for session in dispatch_sessions for target in session.get("skippedTargets", [])]
    target_status_counts = {
        "pending": sum(1 for target in all_targets if target.get("status", "pending") == "pending"),
        "visited": sum(1 for target in all_targets if target.get("status") == "visited"),
        "completed": sum(1 for target in all_targets if target.get("status") == "completed"),
        "skipped": sum(1 for target in all_targets if target.get("status") == "skipped"),
        "error": sum(1 for target in all_targets if target.get("status") == "error"),
        "blocked": len(skipped_targets),
        "total": len(all_targets) + len(skipped_targets),
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
            "pendingTargets": target_status_counts["pending"],
            "visitedTargets": target_status_counts["visited"],
            "completedTargets": target_status_counts["completed"],
            "skippedTargets": target_status_counts["skipped"],
            "errorTargets": target_status_counts["error"],
            "blockedTargets": target_status_counts["blocked"],
            "gaps": len(handoff.get("gaps") or []),
            "actions": len(handoff.get("actions") or []),
            "artifacts": len(artifacts),
        },
        "targetStatusCounts": target_status_counts,
        "artifacts": artifacts,
        "dispatchSessions": dispatch_sessions,
        "acceptedJobs": accepted_jobs,
        "remainingTargets": [target for target in all_targets if target.get("status", "pending") == "pending"],
        "skippedTargets": skipped_targets,
        "reports": {
            "deliveryReport": delivery_report,
            "coverage": coverage,
            "handoffSnapshot": handoff,
        },
    }


def _build_execution_request(project: StudioProject, job: dict[str, Any]) -> dict[str, Any]:
    page = get_page(job.get("pageId"))
    segment = _find_segment(project, job.get("segmentId")) or {
        "id": job.get("segmentId"),
        "type": "video" if job.get("botType") == "image-to-video" else "image",
        "url": job.get("mediaUrl", ""),
        "posterUrl": job.get("posterUrl", ""),
        "prompt": job.get("prompt", ""),
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
    bot = get_bot_by_slug(job.get("botSlug", "")) or {
        "slug": job.get("botSlug", ""),
        "name": job.get("botName", ""),
        "type": job.get("botType", segment.get("type", "image")),
        "rating": 4.5,
        "desc": "",
    }
    source_segment = _find_segment(project, segment.get("parentSegmentId"))
    route = {
        "bot": {
            "slug": bot.get("slug") or job.get("botSlug"),
            "name": bot.get("name") or job.get("botName"),
            "type": bot.get("type") or job.get("botType"),
            "rating": bot.get("rating", 4.5),
            "description": bot.get("desc", ""),
            "pageUrl": f"https://art.myshell.ai/creative/{bot.get('slug') or job.get('botSlug')}",
        },
        "executor": page["executor"],
        "analysis": "Retry queued from persisted Studio job.",
        "sourceSummary": f"Using segment {segment.get('parentSegmentId')}" if segment.get("parentSegmentId") else "Retrying original prompt",
    }
    graph = _set_graph_status(project, route, segment)
    contract = _navigation_contract(page, route, source_segment)
    navigation_path = contract.get("navigationPath", "")
    return {
        "executor": page["executor"],
        "api": page["id"],
        "page": page,
        "agentId": job.get("agentId") or _agent_id_for_page(page),
        **contract,
        "routeParams": page.get("routeParams") or [],
        "missingRouteParams": _missing_route_params(page, navigation_path),
        "jobId": job["jobId"],
        "segmentId": job["segmentId"],
        "botSlug": job.get("botSlug", ""),
        "botName": job.get("botName", ""),
        "botType": job.get("botType", ""),
        "prompt": job.get("prompt", ""),
        "action": job.get("action", "generate"),
        "sourceSegment": source_segment,
        "agentGraph": graph,
        "segment": segment,
        "authStatus": job.get("authStatus") or adapter_auth_status(page["id"]),
        "evidence": job.get("evidence") or {},
    }


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
        )

    @app.get("/api/studio/dispatch-sessions")
    async def list_studio_dispatch_sessions(
        project_id: Optional[str] = Query(None),
        limit: int = Query(20, ge=1, le=200),
    ):
        sessions = [_dispatch_session_view(session) for session in STUDIO_STORE.list_dispatch_sessions(project_id=project_id, limit=limit)]
        return {"sessions": sessions, "count": len(sessions)}

    @app.get("/api/studio/dispatch-sessions/{session_id}")
    async def get_studio_dispatch_session(session_id: str):
        return _get_dispatch_session_or_404(session_id)

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
    ):
        return await _dispatch_preview(
            message=message,
            action=action,
            page_id=page_id,
            agent_id=agent_id,
            project_id=project_id,
            source_segment_id=source_segment_id,
            has_image=has_image,
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
        if image is not None:
            image_data = base64.b64encode(await image.read()).decode()
        has_image = image_data is not None
        source_segment = _resolve_source_segment(project, source_segment_id)
        resolved_source_segment_id = source_segment.get("id") if source_segment else source_segment_id
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

            route = await choose_route(prompt, has_image, normalized_action, source_segment)
            page = page_for_dispatch(route["bot"], page_id, prompt)
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
                    segment["evidence"] = _evidence(
                        "auth_missing",
                        "myshell-art",
                        message="MyShell Art cookies are missing; no generation was attempted.",
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
                        segment["evidence"] = _evidence("error", "myshell-art", message=str(exc))
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

    @app.post("/api/studio/projects/{project_id}/client-result")
    async def post_studio_client_result(project_id: str, payload: dict[str, Any] = Body(...)):
        project = _get_project(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        segment_id = payload.get("segmentId") or payload.get("id")
        segment = _find_segment(project, segment_id)
        if not segment:
            route_bot_slug = payload.get("botSlug") or "seedream-multi-chart"
            bot = get_bot_by_slug(route_bot_slug) or get_bot_by_slug("seedream-multi-chart") or MYSHELL_BOTS[0]
            segment = {
                "id": segment_id or make_id("segment"),
                "type": payload.get("type") or _segment_type_for_bot(bot),
                "url": "",
                "posterUrl": "",
                "prompt": payload.get("prompt") or "",
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
                taskId=segment.get("taskId") or job.get("taskId"),
                mediaUrl=segment.get("url") or job.get("mediaUrl"),
                posterUrl=segment.get("posterUrl") or job.get("posterUrl"),
                evidence=segment.get("evidence"),
                authStatus=segment.get("authStatus"),
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
