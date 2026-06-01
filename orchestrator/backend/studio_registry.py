from __future__ import annotations

import re
from typing import Any

from bot_catalog import MYSHELL_BOTS

DEFAULT_PAGE_ID = "dreamy-miniapp"

PAGE_INTENT_KEYWORDS = {
    "explore": [
        "explore",
        "discover",
        "browse bots",
        "bot discovery",
        "首页",
        "探索",
        "发现",
    ],
    "ai-picks": [
        "ai picks",
        "aipicks",
        "recommendations",
        "recommended",
        "featured",
        "精选",
        "推荐",
    ],
    "bot-detail": [
        "bot detail",
        "bot details",
        "bot profile",
        "agent detail",
        "agent profile",
        "详情",
        "机器人详情",
    ],
    "upload": [
        "upload",
        "image upload",
        "upload image",
        "create with image",
        "start from image",
        "上传",
        "上传图片",
        "传图",
    ],
    "tag-generator": [
        "tag generator",
        "self director",
        "director",
        "prompt composer",
        "compose tags",
        "标签生成",
        "标签",
        "自导演",
    ],
    "library": [
        "library",
        "generated library",
        "generated works",
        "my works",
        "my creations",
        "results",
        "gallery",
        "history",
        "作品库",
        "生成历史",
        "历史作品",
        "我的作品",
        "结果",
    ],
    "energy-store": [
        "energy",
        "energy store",
        "buy energy",
        "store",
        "packs",
        "credits",
        "能量",
        "能量商店",
        "购买能量",
        "充值",
    ],
    "earn": [
        "earn",
        "rewards",
        "earn stats",
        "bonus",
        "赚取",
        "奖励",
        "收益",
    ],
    "share-invite": [
        "share invite",
        "invite",
        "invite friends",
        "referral",
        "share link",
        "邀请",
        "分享邀请",
        "推荐链接",
    ],
    "settings": [
        "settings",
        "preferences",
        "profile settings",
        "account settings",
        "language",
        "设置",
        "偏好",
        "语言",
        "账号设置",
    ],
    "checkin": [
        "checkin",
        "check in",
        "daily checkin",
        "daily claim",
        "签到",
        "每日签到",
        "打卡",
    ],
}


def _navigation_page(
    page_id: str,
    name: str,
    app_route: str,
    capabilities: list[str],
    *,
    kind: str = "miniapp-page",
    route_params: list[str] | None = None,
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
        "routeParams": route_params or [],
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
            route_params=["slug_id"],
        ),
        _navigation_page(
            "upload",
            "Upload",
            "/upload",
            ["image-upload", "bot-generate", "custom-form"],
            route_params=["slug_id"],
        ),
        _navigation_page(
            "tag-generator",
            "Tag Generator",
            "/tag-generator",
            ["self-director", "prompt-compose", "bot-generate"],
            route_params=["slug_id", "img"],
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


def _keyword_matches(normalized_message: str, keyword: str) -> bool:
    normalized_keyword = keyword.lower().strip()
    if not normalized_keyword:
        return False
    if re.fullmatch(r"[a-z0-9-]+", normalized_keyword):
        return re.search(rf"(?<![a-z0-9]){re.escape(normalized_keyword)}(?![a-z0-9])", normalized_message) is not None
    return normalized_keyword in normalized_message


def infer_navigation_page_from_prompt(message: str) -> dict[str, Any] | None:
    normalized = (message or "").lower()
    if not normalized:
        return None

    best_page_id = ""
    best_score = 0
    for page_id, keywords in PAGE_INTENT_KEYWORDS.items():
        score = sum(1 for keyword in keywords if _keyword_matches(normalized, keyword))
        if score > best_score:
            best_page_id = page_id
            best_score = score

    if not best_page_id:
        return None
    return get_page(best_page_id)


def page_for_bot(bot: dict[str, Any], preferred_page_id: str | None = None) -> dict[str, Any]:
    preferred = get_page(preferred_page_id)
    if preferred["id"] == "myshell-art" or preferred.get("executor") == "navigation":
        return preferred
    # Dreamy stays the default because its authenticated miniapp APIs are already
    # used by the current frontend executor.
    return get_page(DEFAULT_PAGE_ID)


def page_for_dispatch(
    bot: dict[str, Any],
    preferred_page_id: str | None = None,
    message: str = "",
) -> dict[str, Any]:
    preferred = get_page(preferred_page_id)
    if preferred["id"] != DEFAULT_PAGE_ID:
        return page_for_bot(bot, preferred_page_id)

    inferred = infer_navigation_page_from_prompt(message)
    if inferred:
        return inferred
    return page_for_bot(bot, preferred_page_id)
