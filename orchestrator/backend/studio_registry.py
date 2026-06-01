from __future__ import annotations

from typing import Any

from bot_catalog import MYSHELL_BOTS


def list_studio_pages() -> list[dict[str, Any]]:
    """Return MyShell surfaces that the Studio hub can route into."""
    return [
        {
            "id": "dreamy-miniapp",
            "name": "Dreamy Miniapp",
            "kind": "miniapp",
            "baseUrl": "https://api.myshell.fun/v1/telegram/miniapp/dreamy",
            "executor": "client",
            "authMode": "telegram-init-data",
            "status": "available",
            "capabilities": [
                "generate",
                "generate-result",
                "task-running",
                "task-cancel",
                "task-retry",
                "library",
            ],
        },
        {
            "id": "myshell-art",
            "name": "MyShell Art",
            "kind": "web-cdp",
            "baseUrl": "https://art.myshell.ai",
            "executor": "server",
            "authMode": "browser-cookies",
            "status": "available",
            "botCount": len(MYSHELL_BOTS),
            "capabilities": [
                "page-open",
                "image-upload",
                "generate",
                "progress-detect",
                "new-media-evidence",
            ],
        },
    ]


def list_studio_agents() -> list[dict[str, Any]]:
    return [
        {
            "id": "intent-router",
            "label": "Intent Router",
            "pageId": "studio",
            "role": "Turns natural language into a route and bot target.",
            "capabilities": ["prompt-analysis", "bot-selection"],
        },
        {
            "id": "asset-planner",
            "label": "Asset Planner",
            "pageId": "studio",
            "role": "Chooses source media and output shape.",
            "capabilities": ["source-selection", "segment-planning"],
        },
        {
            "id": "dreamy-miniapp-executor",
            "label": "Dreamy Miniapp Executor",
            "pageId": "dreamy-miniapp",
            "role": "Delegates Dreamy miniapp jobs to the authenticated browser client.",
            "capabilities": ["generate", "poll-result", "cancel", "retry"],
        },
        {
            "id": "myshell-art-cdp-executor",
            "label": "MyShell Art CDP Executor",
            "pageId": "myshell-art",
            "role": "Runs MyShell Art pages through the Chrome DevTools bridge.",
            "capabilities": ["open-page", "upload-image", "click-generate", "extract-new-media"],
        },
        {
            "id": "evidence-verifier",
            "label": "Evidence Verifier",
            "pageId": "studio",
            "role": "Accepts only fresh media, task ids, or explicit failure states.",
            "capabilities": ["freshness-check", "auth-state", "timeout-state"],
        },
        {
            "id": "timeline",
            "label": "Timeline",
            "pageId": "studio",
            "role": "Stores accepted segment state in the project timeline.",
            "capabilities": ["append-segment", "select-segment", "persist-project"],
        },
    ]


def get_page(page_id: str | None) -> dict[str, Any]:
    pages = list_studio_pages()
    for page in pages:
        if page["id"] == page_id:
            return page
    return pages[0]


def page_for_bot(bot: dict[str, Any], preferred_page_id: str | None = None) -> dict[str, Any]:
    preferred = get_page(preferred_page_id)
    if preferred["id"] == "myshell-art":
        return preferred
    # Dreamy stays the default because its authenticated miniapp APIs are already
    # used by the current frontend executor.
    return get_page("dreamy-miniapp")
