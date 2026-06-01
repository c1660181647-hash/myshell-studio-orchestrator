from __future__ import annotations

import json
import os
import uuid
from datetime import datetime
from typing import Any, Optional

from fastapi import Body, File, Form, HTTPException, UploadFile
from sse_starlette.sse import EventSourceResponse

from bot_catalog import MYSHELL_BOTS, get_bot_by_slug

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

PLACEHOLDER_POSTERS = {
    "generate": "/gallery/creative-whale.jpg",
    "extend": "/gallery/video-flower.jpg",
    "restyle": "/gallery/style-cyber-tokyo.jpg",
    "retry-agent": "/gallery/anime-cyber.jpg",
}


def now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def make_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def _normalize_mode(mode: str) -> str:
    return mode if mode in VALID_MODES else "player"


def _normalize_action(action: str) -> str:
    return action if action in VALID_ACTIONS else "generate"


def _segment_type_for_bot(bot: dict[str, Any]) -> str:
    return "video" if bot.get("type") == "image-to-video" else "image"


def _project(project_id: Optional[str] = None, mode: str = "player") -> StudioProject:
    if project_id and project_id in PROJECTS:
        project = PROJECTS[project_id]
        project["mode"] = _normalize_mode(mode or project.get("mode", "player"))
        project["updatedAt"] = now_iso()
        return project

    new_id = project_id or make_id("project")
    project = {
        "projectId": new_id,
        "conversationId": make_id("conversation"),
        "mode": _normalize_mode(mode),
        "messages": [],
        "segments": [],
        "selectedSegmentId": None,
        "agentGraph": default_agent_graph(),
        "updatedAt": now_iso(),
    }
    PROJECTS[new_id] = project
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
            "label": "Dreamy Executor",
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
    graph[3]["status"] = "queued" if segment else "idle"
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
    return message


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
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
    }
    project["segments"].append(segment)
    project["selectedSegmentId"] = segment["id"]
    project["updatedAt"] = now_iso()
    return segment


def _event(event: str, payload: StudioEvent) -> dict[str, str]:
    payload.setdefault("type", event)
    return {"event": event, "data": json.dumps(payload, ensure_ascii=False)}


def register_studio_routes(app) -> None:
    @app.post("/api/studio/run")
    async def run_studio(
        message: str = Form(""),
        project_id: Optional[str] = Form(None),
        mode: str = Form("player"),
        action: str = Form("generate"),
        source_segment_id: Optional[str] = Form(None),
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

        has_image = image is not None
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
            route["action"] = normalized_action
            route["sourceSegmentId"] = source_segment_id
            route["sourceSummary"] = (
                f"Using segment {source_segment_id}" if source_segment_id else "Starting from prompt"
            )
            yield _event("route", route)

            yield _event(
                "progress",
                {
                    "step": "planning",
                    "message": "Preparing Dreamy segment request",
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
            graph = _set_graph_status(project, route, segment)
            _append_message(
                project,
                "assistant",
                f"Queued {route['bot']['name']} for {normalized_action}.",
                route=route,
                segmentId=segment["id"],
            )

            yield _event(
                "execution_request",
                {
                    "executor": route["executor"],
                    "api": "dreamy-miniapp",
                    "segmentId": segment["id"],
                    "botSlug": route["bot"]["slug"],
                    "botName": route["bot"]["name"],
                    "botType": route["bot"]["type"],
                    "prompt": route.get("optimizedPrompt") or prompt,
                    "action": normalized_action,
                    "sourceSegment": source_segment,
                    "agentGraph": graph,
                    "segment": segment,
                },
            )

            yield _event(
                "project",
                {
                    "project": project,
                },
            )

            yield _event(
                "done",
                {
                    "status": "queued",
                    "projectId": project["projectId"],
                    "segmentId": segment["id"],
                },
            )

        return EventSourceResponse(event_generator(), ping=15)

    @app.get("/api/studio/projects/{project_id}")
    async def get_studio_project(project_id: str):
        project = PROJECTS.get(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        return project

    @app.post("/api/studio/projects/{project_id}/client-result")
    async def post_studio_client_result(project_id: str, payload: dict[str, Any] = Body(...)):
        project = PROJECTS.get(project_id)
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
                "createdAt": now_iso(),
                "updatedAt": now_iso(),
            }
            project["segments"].append(segment)

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
        ):
            if key in payload and payload[key] is not None:
                segment[key] = payload[key]
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
        return {"project": project, "segment": segment}

    @app.post("/api/studio/projects/{project_id}/reset")
    async def reset_studio_project(project_id: str):
        if project_id in PROJECTS:
            del PROJECTS[project_id]
        return {"projectId": project_id, "status": "reset"}
