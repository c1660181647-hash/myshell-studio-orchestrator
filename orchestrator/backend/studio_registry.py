from __future__ import annotations

from typing import Any

from bot_catalog import MYSHELL_BOTS


def _navigation_page(
    page_id: str,
    name: str,
    app_route: str,
    capabilities: list[str],
    *,
    kind: str = "miniapp-page",
) -> dict[str, Any]:
    return {
        "id": page_id,
        "name": name,
        "kind": kind,
        "baseUrl": "https://api.myshell.fun/v1/telegram/miniapp/dreamy",
        "appRoute": app_route,
        "executor": "navigation",
        "authMode": "telegram-init-data",
        "status": "available",
        "dispatchMode": "open-page",
        "capabilities": capabilities,
    }


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
            "dispatchMode": "execute-client",
            "appRoute": "/dreamy",
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
            "dispatchMode": "execute-server",
            "appRoute": "",
            "botCount": len(MYSHELL_BOTS),
            "capabilities": [
                "page-open",
                "image-upload",
                "generate",
                "progress-detect",
                "new-media-evidence",
            ],
        },
        _navigation_page(
            "explore",
            "Explore",
            "/",
            ["explore", "category-browse", "bot-discovery"],
        ),
        _navigation_page(
            "ai-picks",
            "AI Picks",
            "/ai-picks",
            ["recommendations", "pick-opened", "bot-discovery"],
        ),
        _navigation_page(
            "bot-detail",
            "Bot Detail",
            "/bot",
            ["get-by-slug", "form-schema", "bot-profile"],
        ),
        _navigation_page(
            "upload",
            "Upload",
            "/upload",
            ["image-upload", "bot-generate", "custom-form"],
        ),
        _navigation_page(
            "tag-generator",
            "Tag Generator",
            "/tag-generator",
            ["self-director", "prompt-compose", "bot-generate"],
        ),
        _navigation_page(
            "library",
            "Library",
            "/library",
            ["library", "task-retry", "task-delete", "task-like", "share"],
        ),
        _navigation_page(
            "energy-store",
            "Energy Store",
            "/energy",
            ["energy", "packs", "invoice"],
        ),
        _navigation_page(
            "earn",
            "Earn",
            "/earn",
            ["invite-code", "earn-stats"],
        ),
        _navigation_page(
            "share-invite",
            "Share Invite",
            "/share-invite",
            ["invite-share", "invite-opened"],
        ),
        _navigation_page(
            "settings",
            "Settings",
            "/settings",
            ["profile", "language", "preferences"],
        ),
        _navigation_page(
            "checkin",
            "Checkin",
            "/checkin-demo",
            ["checkin-status", "checkin-claim", "checkin-history"],
        ),
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
            "id": "miniapp-page-navigator",
            "label": "Miniapp Page Navigator",
            "pageId": "miniapp",
            "role": "Dispatches operators into registered MyShell miniapp pages.",
            "capabilities": ["open-page", "restore-route", "surface-intent"],
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
    if preferred["id"] == "myshell-art" or preferred.get("executor") == "navigation":
        return preferred
    # Dreamy stays the default because its authenticated miniapp APIs are already
    # used by the current frontend executor.
    return get_page("dreamy-miniapp")
