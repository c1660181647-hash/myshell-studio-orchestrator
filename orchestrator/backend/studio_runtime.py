from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from typing import Any

import httpx


CDP_URL = os.environ.get("MYSHELL_CDP_URL", "http://127.0.0.1:9222")
DEFAULT_COOKIE_INJECTION_STATUS_PATH = os.path.join(os.path.dirname(__file__), ".studio", "cookie-injection-status.json")


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


def cookie_injection_status(has_cookies: bool) -> dict[str, Any]:
    status_path = os.environ.get("MYSHELL_COOKIE_INJECTION_STATUS_PATH") or DEFAULT_COOKIE_INJECTION_STATUS_PATH
    if not has_cookies:
        return {
            "status": "auth_missing",
            "mode": "env-or-file",
            "statusPath": status_path,
            "message": "Set MYSHELL_COOKIES or a backend cookie file",
        }
    if not os.path.exists(status_path):
        return {
            "status": "pending",
            "mode": "cdp-status-file",
            "statusPath": status_path,
            "message": "Cookie source is available; no Chrome injection result has been recorded yet",
        }
    try:
        with open(status_path, encoding="utf-8") as status_file:
            payload = json.load(status_file)
    except Exception as exc:
        return {
            "status": "error",
            "mode": "cdp-status-file",
            "statusPath": status_path,
            "message": f"Cookie injection status could not be read: {exc}",
        }

    raw_status = str(payload.get("status") or "").strip().lower()
    normalized_status = "ready" if raw_status in {"success", "ready", "ok"} else "error"
    return {
        "status": normalized_status,
        "mode": "cdp-status-file",
        "statusPath": status_path,
        "checkedAt": payload.get("checkedAt") or payload.get("updatedAt") or "",
        "cookieCount": payload.get("cookieCount", 0),
        "energyDisplay": payload.get("energyDisplay", ""),
        "message": str(payload.get("message") or ("Cookie injection succeeded" if normalized_status == "ready" else "Cookie injection failed")),
    }


async def runtime_health(store_path: str) -> dict[str, Any]:
    storage_ready = os.path.exists(os.path.dirname(store_path)) and os.access(os.path.dirname(store_path), os.W_OK)
    has_cookies = cookies_available()
    cdp_ready = await chrome_cdp_ready()
    dreamy_auth = "client_delegated"
    art_auth = "ready" if has_cookies else "auth_missing"
    injection_status = cookie_injection_status(has_cookies)
    degraded_component = (
        not storage_ready
        or not cdp_ready
        or str(injection_status.get("status") or "") in {"error", "pending"}
    )
    overall = "degraded" if degraded_component else "ok"
    return {
        "status": overall,
        "version": "0.2.0",
        "checkedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "components": {
            "backend": {"status": "ok", "message": "FastAPI runtime is serving requests"},
            "storage": {"status": "ok" if storage_ready else "error", "path": store_path},
            "chromeCdp": {"status": "ok" if cdp_ready else "unavailable", "url": CDP_URL},
            "myshellCookies": {"status": art_auth, "message": "Cookies configured" if has_cookies else "No MyShell cookies configured"},
            "cookieInjection": injection_status,
            "dreamyApiAuth": {"status": dreamy_auth, "mode": "telegram-init-data"},
        },
    }


def adapter_auth_status(page_id: str) -> dict[str, Any]:
    if page_id == "myshell-art":
        has_cookies = cookies_available()
        injection_status = cookie_injection_status(has_cookies)
        injection_state = str(injection_status.get("status") or "")
        ready = has_cookies and injection_state == "ready"
        return {
            "status": "ready" if ready else "auth_missing",
            "mode": "browser-cookies",
            "message": (
                "MyShell cookies are injected into Chrome"
                if ready
                else str(injection_status.get("message") or "Set MYSHELL_COOKIES or myshell-cookies.json")
            ),
            "injectionStatus": injection_state,
            "statusPath": injection_status.get("statusPath", ""),
        }
    return {
        "status": "client_delegated",
        "mode": "telegram-init-data",
        "message": "Uses the authenticated Telegram miniapp browser session",
    }
