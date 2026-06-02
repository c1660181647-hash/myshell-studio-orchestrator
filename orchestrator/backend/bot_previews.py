from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from bot_catalog import MYSHELL_BOTS

PREVIEW_BASE_PATH = "/generated/bot-previews"
MODULE_DIR = Path(__file__).resolve().parent
DEFAULT_MANIFEST_PATHS = [
    MODULE_DIR.parent.parent / "frontend" / "public" / "generated" / "bot-previews" / "manifest.json",
    MODULE_DIR / "frontend" / "dist" / "generated" / "bot-previews" / "manifest.json",
    MODULE_DIR.parent / "frontend" / "dist" / "generated" / "bot-previews" / "manifest.json",
    Path("/app/frontend/dist/generated/bot-previews/manifest.json"),
]

DREAMY_BOTS = [
    {
        "slug": "ai-porn-generator",
        "name": "Dreamy Image Agent",
        "icon": "✨",
        "type": "text-to-image",
        "desc": "Dreamy prompt-to-image generation inside the authenticated miniapp.",
        "keywords": ["dreamy", "image", "prompt", "character", "source"],
        "rating": 4.8,
        "pageId": "dreamy-miniapp",
    },
    {
        "slug": "image-to-video-generator",
        "name": "Dreamy Video Agent",
        "icon": "🎬",
        "type": "image-to-video",
        "desc": "Dreamy image-to-video segment generation for Studio timelines.",
        "keywords": ["dreamy", "video", "motion", "segment", "extend"],
        "rating": 4.7,
        "pageId": "dreamy-miniapp",
    },
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def manifest_path() -> Path:
    configured = os.environ.get("STUDIO_BOT_PREVIEWS_MANIFEST")
    if configured:
        return Path(configured)
    for path in DEFAULT_MANIFEST_PATHS:
        if path.exists():
            return path
    return DEFAULT_MANIFEST_PATHS[0]


def load_preview_manifest() -> dict[str, Any]:
    path = manifest_path()
    if not path.exists():
        return {
            "version": "missing",
            "generatedAt": "",
            "source": "missing-manifest",
            "assets": [],
            "botPreviews": {},
            "starterPresets": {},
        }
    with path.open(encoding="utf-8") as manifest_file:
        manifest = json.load(manifest_file)
    if not isinstance(manifest, dict):
        raise ValueError(f"Bot preview manifest must be an object: {path}")
    manifest.setdefault("assets", [])
    manifest.setdefault("botPreviews", {})
    manifest.setdefault("starterPresets", {})
    return manifest


def _asset_by_id(manifest: dict[str, Any]) -> dict[str, dict[str, Any]]:
    assets: dict[str, dict[str, Any]] = {}
    for asset in manifest.get("assets", []):
        if isinstance(asset, dict) and asset.get("id"):
            assets[str(asset["id"])] = asset
    return assets


def _default_asset_id_for_bot(bot: dict[str, Any]) -> str:
    slug = str(bot.get("slug") or "")
    bot_type = str(bot.get("type") or "")
    keywords = {str(keyword).lower() for keyword in bot.get("keywords", [])}

    if bot_type == "image-to-video" or {"video", "motion", "dance", "animate"} & keywords:
        return "video-motion"
    if {"blind box", "toy", "3d", "figure", "collectible", "isometric", "keychain"} & keywords:
        return "collectible-product"
    if {"neon", "sketch", "pixel", "style", "poster", "emoji"} & keywords:
        return "style-transfer"
    if {"room", "interior", "ad", "advertising", "banner", "twitch", "card", "tool"} & keywords:
        return "creative-toolkit"
    if {"face", "beauty", "score", "celebrity", "baby", "old", "hair", "roast", "filter"} & keywords:
        return "creative-toolkit"
    if slug == "ai-porn-generator":
        return "cinematic-neon-city"
    return "character-scene" if bot_type == "image-to-image" else "cinematic-neon-city"


def _preview_from_asset(bot: dict[str, Any], asset: dict[str, Any], manifest: dict[str, Any]) -> dict[str, Any]:
    source_url = str(asset.get("mediaUrl") or asset.get("thumbnailUrl") or "")
    original_url = str(asset.get("originalRemoteUrl") or "")
    checked_at = str(asset.get("checkedAt") or manifest.get("generatedAt") or _now_iso())
    return {
        "botSlug": bot["slug"],
        "botName": bot["name"],
        "botType": bot.get("type"),
        "pageId": bot.get("pageId") or "myshell-art",
        "status": "ready",
        "accepted": True,
        "mediaUrl": source_url,
        "thumbnailUrl": source_url,
        "posterUrl": source_url,
        "assetId": asset.get("id"),
        "source": asset.get("source") or manifest.get("source") or "myshell-openapi",
        "sourceWidgetId": asset.get("sourceWidgetId"),
        "sourceWidgetName": asset.get("sourceWidgetName"),
        "originalRemoteUrl": original_url,
        "generatedPrompt": asset.get("prompt"),
        "checkedAt": checked_at,
        "previewKind": "representative_real_myshell_output",
        "botSpecific": False,
        "evidence": {
            "status": "done",
            "source": asset.get("source") or manifest.get("source") or "myshell-openapi",
            "accepted": True,
            "mediaUrl": source_url,
            "checkedAt": checked_at,
            "message": "Preview is a real MyShell OpenAPI generated image stored as a local Studio asset.",
        },
    }


def _missing_preview(bot: dict[str, Any], manifest: dict[str, Any], asset_id: str) -> dict[str, Any]:
    checked_at = str(manifest.get("generatedAt") or _now_iso())
    return {
        "botSlug": bot["slug"],
        "botName": bot["name"],
        "botType": bot.get("type"),
        "pageId": bot.get("pageId") or "myshell-art",
        "status": "needs_generation",
        "accepted": False,
        "assetId": asset_id,
        "source": "missing-preview-asset",
        "checkedAt": checked_at,
        "previewKind": "missing",
        "botSpecific": False,
        "message": "Run the MyShell preview refresh tool after credentials are configured.",
        "evidence": {
            "status": "auth_missing",
            "source": "missing-preview-asset",
            "accepted": False,
            "checkedAt": checked_at,
            "message": "No verified MyShell preview asset is available for this bot yet.",
        },
    }


def _all_preview_bots() -> list[dict[str, Any]]:
    art_bots = [{**bot, "pageId": "myshell-art"} for bot in MYSHELL_BOTS]
    return [*DREAMY_BOTS, *art_bots]


def preview_for_bot(bot: dict[str, Any], manifest: dict[str, Any] | None = None) -> dict[str, Any]:
    preview_manifest = manifest or load_preview_manifest()
    assets = _asset_by_id(preview_manifest)
    overrides = preview_manifest.get("botPreviews", {})
    override = overrides.get(bot["slug"], {}) if isinstance(overrides, dict) else {}
    asset_id = str(override.get("assetId") or _default_asset_id_for_bot(bot))
    asset = assets.get(asset_id)
    if not asset:
        return _missing_preview(bot, preview_manifest, asset_id)
    preview = _preview_from_asset(bot, asset, preview_manifest)
    if isinstance(override, dict):
        preview.update({key: value for key, value in override.items() if key not in {"assetId"}})
    return preview


def list_bot_previews() -> dict[str, Any]:
    manifest = load_preview_manifest()
    bots = _all_preview_bots()
    previews = [preview_for_bot(bot, manifest) for bot in bots]
    ready_count = sum(1 for preview in previews if preview.get("status") == "ready" and preview.get("accepted"))
    return {
        "version": manifest.get("version") or "missing",
        "source": manifest.get("source") or "missing-manifest",
        "generatedAt": manifest.get("generatedAt") or "",
        "checkedAt": _now_iso(),
        "manifestPath": str(manifest_path()),
        "summary": {
            "total": len(previews),
            "ready": ready_count,
            "needsGeneration": len(previews) - ready_count,
            "assets": len(manifest.get("assets", [])),
            "dreamyBots": len(DREAMY_BOTS),
            "artBots": len(MYSHELL_BOTS),
        },
        "assets": manifest.get("assets", []),
        "starterPresets": manifest.get("starterPresets", {}),
        "previews": previews,
    }
