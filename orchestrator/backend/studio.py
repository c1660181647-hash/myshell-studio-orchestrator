from __future__ import annotations

import json
import os
import uuid
import base64
from datetime import UTC, datetime
from typing import Any, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import Body, File, Form, HTTPException, Query, UploadFile
from sse_starlette.sse import EventSourceResponse

from bot_catalog import MYSHELL_BOTS, get_bot_by_slug
from studio_registry import get_page, list_studio_agents, list_studio_pages, page_for_dispatch
from studio_runtime import adapter_auth_status
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
    query: dict[str, str] = {key: value for key, value in parse_qsl(parsed_path.query, keep_blank_values=True)}
    query.update({key: str(value) for key, value in (page.get("routeDefaults") or {}).items() if value is not None})
    bot_slug = (route or {}).get("bot", {}).get("slug") or ""
    if "slug_id" in route_params and bot_slug:
        query["slug_id"] = bot_slug
    if "img" in route_params and source_segment:
        source_url = source_segment.get("url") or source_segment.get("posterUrl") or ""
        if source_url:
            query["img"] = source_url
    if not query:
        return urlunsplit((parsed_path.scheme, parsed_path.netloc, parsed_path.path, "", parsed_path.fragment))
    return urlunsplit((parsed_path.scheme, parsed_path.netloc, parsed_path.path, urlencode(query), parsed_path.fragment))


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
    return {
        "executor": page["executor"],
        "api": page["id"],
        "page": page,
        "agentId": job.get("agentId") or _agent_id_for_page(page),
        **_navigation_contract(page, route, source_segment),
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
        return {"pages": list_studio_pages()}

    @app.get("/api/agents")
    async def get_studio_agents():
        return {"agents": list_studio_agents()}

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
        source_segment = _find_segment(project, source_segment_id)
        _append_message(
            project,
            "user",
            prompt,
            action=normalized_action,
            sourceSegmentId=source_segment_id,
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
            route["sourceSegmentId"] = source_segment_id
            route["sourceSummary"] = (
                f"Using segment {source_segment_id}" if source_segment_id else "Starting from prompt"
            )
            route["page"] = page
            route["api"] = page["id"]
            route["executor"] = page["executor"]
            route["agentId"] = _agent_id_for_dispatch(page, agent_id)
            route.update(_navigation_contract(page, route, source_segment))
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
                source_segment_id,
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
                segment["status"] = "done"
                segment["evidence"] = _evidence(
                    "done",
                    page["id"],
                    accepted=True,
                    message=f"Navigation dispatch prepared for {page['name']} at {_navigation_path_for_page(page, route, source_segment)}.",
                )
                segment["updatedAt"] = now_iso()
                _update_job(
                    job,
                    status="done",
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
        job = _update_job(
            job,
            status="cancelled",
            evidence=_evidence("cancelled", job.get("pageId", "studio"), message="Cancelled by Studio operator."),
        )
        project = _get_project(job["projectId"])
        if project:
            segment = _find_segment(project, job["segmentId"])
            if segment:
                segment["status"] = "cancelled"
                segment["evidence"] = job["evidence"]
                segment["updatedAt"] = now_iso()
            project["updatedAt"] = now_iso()
            _sync_project_jobs(project)
        return {"job": _job_with_evidence(job), "project": project}

    @app.post("/api/studio/jobs/{job_id}/retry")
    async def retry_studio_job(job_id: str):
        job = STUDIO_STORE.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        job = _update_job(
            job,
            status="queued",
            attempt=int(job.get("attempt") or 1) + 1,
            evidence=_evidence("queued", job.get("pageId", "studio"), message="Retry queued; waiting for adapter execution."),
        )
        project = _get_project(job["projectId"])
        if project:
            segment = _find_segment(project, job["segmentId"])
            if segment:
                segment["status"] = "queued"
                segment["evidence"] = job["evidence"]
                segment["updatedAt"] = now_iso()
            project["updatedAt"] = now_iso()
            execution_request = _build_execution_request(project, job)
            _sync_project_jobs(project)
        else:
            execution_request = None
        return {"job": _job_with_evidence(job), "project": project, "executionRequest": execution_request}
