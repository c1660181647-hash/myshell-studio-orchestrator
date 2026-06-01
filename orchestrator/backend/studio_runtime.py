from __future__ import annotations

import os
from typing import Any

import httpx


CDP_URL = os.environ.get("MYSHELL_CDP_URL", "http://127.0.0.1:9222")


def cookies_available() -> bool:
    if os.environ.get("MYSHELL_COOKIES"):
        return True
    base = os.path.dirname(__file__)
    return any(
        os.path.exists(os.path.join(base, filename))
        for filename in ("myshell-cookies.json", "myshell_cookies_embedded.json")
    )


async def chrome_cdp_ready() -> bool:
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            response = await client.get(f"{CDP_URL}/json")
        return response.status_code == 200
    except Exception:
        return False


async def runtime_health(store_path: str) -> dict[str, Any]:
    storage_ready = os.path.exists(os.path.dirname(store_path)) and os.access(os.path.dirname(store_path), os.W_OK)
    has_cookies = cookies_available()
    cdp_ready = await chrome_cdp_ready()
    dreamy_auth = "client_delegated"
    art_auth = "ready" if has_cookies else "auth_missing"
    overall = "ok" if storage_ready else "degraded"
    return {
        "status": overall,
        "version": "0.2.0",
        "components": {
            "backend": {"status": "ok"},
            "storage": {"status": "ok" if storage_ready else "error", "path": store_path},
            "chromeCdp": {"status": "ok" if cdp_ready else "unavailable", "url": CDP_URL},
            "myshellCookies": {"status": art_auth},
            "dreamyApiAuth": {"status": dreamy_auth},
        },
    }


def adapter_auth_status(page_id: str) -> dict[str, Any]:
    if page_id == "myshell-art":
        return {
            "status": "ready" if cookies_available() else "auth_missing",
            "mode": "browser-cookies",
            "message": "MyShell cookies configured" if cookies_available() else "Set MYSHELL_COOKIES or myshell-cookies.json",
        }
    return {
        "status": "client_delegated",
        "mode": "telegram-init-data",
        "message": "Uses the authenticated Telegram miniapp browser session",
    }
