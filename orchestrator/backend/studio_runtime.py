from __future__ import annotations

import json
import os
import shutil
from datetime import UTC, datetime
from typing import Any

import httpx


DEFAULT_CDP_URL = "http://127.0.0.1:9222"
DEFAULT_COOKIE_INJECTION_STATUS_PATH = os.path.join(os.path.dirname(__file__), ".studio", "cookie-injection-status.json")
COOKIE_FILE_NAMES = ("myshell-cookies.json", "myshell_cookies_embedded.json")
DREAMY_INIT_DATA_ENV_NAMES = ("DREAMY_TELEGRAM_INIT_DATA", "MYSHELL_DREAMY_INIT_DATA")
DREAMY_DEFAULT_API_BASE_URL = "https://api.myshell.fun"
SECRET_BINDINGS = (
    {
        "env": "DREAMY_TELEGRAM_INIT_DATA",
        "secret": "myshell-dreamy-init-data",
        "purpose": "server-side Dreamy miniapp generation",
    },
    {
        "env": "MYSHELL_COOKIES",
        "secret": "myshell-cookies",
        "purpose": "MyShell Art browser cookie injection",
    },
)


def cdp_url() -> str:
    return (os.environ.get("MYSHELL_CDP_URL") or DEFAULT_CDP_URL).rstrip("/")


def _cookie_payload_status(payload: Any, *, mode: str, source: str) -> dict[str, Any]:
    if not isinstance(payload, list):
        return {
            "status": "error",
            "mode": mode,
            "source": source,
            "message": f"{source} must be a valid JSON cookie array",
        }
    if not payload:
        return {
            "status": "auth_missing",
            "mode": mode,
            "source": source,
            "cookieCount": 0,
            "message": f"{source} contains no cookies",
        }
    for index, cookie in enumerate(payload):
        if not isinstance(cookie, dict) or not cookie.get("name") or cookie.get("value") is None:
            return {
                "status": "error",
                "mode": mode,
                "source": source,
                "cookieCount": len(payload),
                "message": f"{source}[{index}] must include cookie name and value",
            }
    return {
        "status": "ready",
        "mode": mode,
        "source": source,
        "cookieCount": len(payload),
        "message": "Cookies configured",
    }


def cookie_source_status() -> dict[str, Any]:
    env = os.environ.get("MYSHELL_COOKIES")
    if env:
        try:
            return _cookie_payload_status(json.loads(env), mode="env", source="MYSHELL_COOKIES")
        except Exception as exc:
            return {
                "status": "error",
                "mode": "env",
                "source": "MYSHELL_COOKIES",
                "message": f"MYSHELL_COOKIES must be valid JSON: {exc}",
            }

    base = os.path.dirname(__file__)
    for filename in COOKIE_FILE_NAMES:
        path = os.path.join(base, filename)
        if not os.path.exists(path):
            continue
        try:
            with open(path, encoding="utf-8") as cookie_file:
                return _cookie_payload_status(json.load(cookie_file), mode="file", source=filename)
        except Exception as exc:
            return {
                "status": "error",
                "mode": "file",
                "source": filename,
                "message": f"{filename} must be valid JSON: {exc}",
            }

    return {
        "status": "auth_missing",
        "mode": "env-or-file",
        "message": "No MyShell cookies configured",
    }


def cookies_available() -> bool:
    return cookie_source_status().get("status") == "ready"


def dreamy_init_data() -> str:
    for env_name in DREAMY_INIT_DATA_ENV_NAMES:
        value = os.environ.get(env_name)
        if value and value.strip():
            return value.strip()
    return ""


def dreamy_api_base_url() -> str:
    return (os.environ.get("DREAMY_API_BASE_URL") or DREAMY_DEFAULT_API_BASE_URL).rstrip("/")


def dreamy_api_auth_status() -> dict[str, Any]:
    configured_env = next((name for name in DREAMY_INIT_DATA_ENV_NAMES if os.environ.get(name)), "")
    if dreamy_init_data():
        return {
            "status": "ready",
            "mode": "server-telegram-init-data",
            "message": "Server-side Dreamy init data is configured; Studio can run Dreamy generation from the backend.",
            "source": configured_env,
            "baseUrl": dreamy_api_base_url(),
        }
    return {
        "status": "client_delegated",
        "mode": "telegram-init-data",
        "message": "Uses the authenticated Telegram miniapp browser session",
        "baseUrl": dreamy_api_base_url(),
    }


def ffmpeg_status() -> dict[str, Any]:
    path = shutil.which("ffmpeg")
    if not path:
        return {
            "status": "unavailable",
            "message": "FFmpeg is unavailable; long-video exports will return timeline manifests only.",
        }
    return {
        "status": "ok",
        "path": path,
        "message": "FFmpeg is available for long-video timeline export.",
    }


def credential_setup_status() -> dict[str, Any]:
    bindings: list[dict[str, Any]] = []
    missing: list[str] = []
    for binding in SECRET_BINDINGS:
        env_name = str(binding["env"])
        configured = bool(os.environ.get(env_name))
        bindings.append(
            {
                **binding,
                "configured": configured,
                "status": "ready" if configured else "missing",
            }
        )
        if not configured:
            missing.append(env_name)
    if not missing:
        return {
            "status": "ready",
            "mode": "cloud-run-secrets",
            "bindings": bindings,
            "message": "Dreamy and MyShell Art credentials are injected into the runtime.",
        }
    return {
        "status": "needs_configuration",
        "mode": "cloud-run-secrets",
        "bindings": bindings,
        "message": "Create Secret Manager secrets myshell-dreamy-init-data and myshell-cookies; Cloud Build binds them automatically when present.",
        "missingEnv": missing,
    }


async def chrome_cdp_ready() -> bool:
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            response = await client.get(f"{cdp_url()}/json")
        return response.status_code == 200
    except Exception:
        return False


def chrome_cdp_status(timeout: float = 0.75) -> dict[str, Any]:
    url = cdp_url()
    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.get(f"{url}/json")
    except Exception as exc:
        return {
            "status": "unavailable",
            "url": url,
            "message": f"Chrome CDP is unavailable: {exc}",
        }
    if response.status_code != 200:
        return {
            "status": "unavailable",
            "url": url,
            "message": f"Chrome CDP returned HTTP {response.status_code}",
        }
    return {
        "status": "ok",
        "url": url,
        "message": "Chrome CDP is reachable",
    }


def cookie_injection_status(has_cookies: bool, cookie_source: dict[str, Any] | None = None) -> dict[str, Any]:
    status_path = os.environ.get("MYSHELL_COOKIE_INJECTION_STATUS_PATH") or DEFAULT_COOKIE_INJECTION_STATUS_PATH
    cookie_source = cookie_source or cookie_source_status()
    if cookie_source.get("status") == "error":
        return {
            "status": "error",
            "mode": "cookie-source",
            "statusPath": status_path,
            "message": str(cookie_source.get("message") or "Cookie source is invalid"),
        }
    if not has_cookies:
        return {
            "status": "auth_missing",
            "mode": "env-or-file",
            "statusPath": status_path,
            "message": str(cookie_source.get("message") or "Set MYSHELL_COOKIES or a backend cookie file"),
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
    cookie_source = cookie_source_status()
    has_cookies = cookie_source.get("status") == "ready"
    cdp_ready = await chrome_cdp_ready()
    art_auth = "ready" if has_cookies else "auth_missing"
    injection_status = cookie_injection_status(has_cookies, cookie_source)
    media_export_status = ffmpeg_status()
    credential_setup = credential_setup_status()
    degraded_component = (
        not storage_ready
        or not cdp_ready
        or str(injection_status.get("status") or "") in {"auth_missing", "error", "pending"}
        or credential_setup.get("status") == "needs_configuration"
    )
    overall = "degraded" if degraded_component else "ok"
    return {
        "status": overall,
        "version": "0.2.0",
        "checkedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "components": {
            "backend": {"status": "ok", "message": "FastAPI runtime is serving requests"},
            "storage": {"status": "ok" if storage_ready else "error", "path": store_path},
            "chromeCdp": {"status": "ok" if cdp_ready else "unavailable", "url": cdp_url()},
            "myshellCookies": {**cookie_source, "status": "ready" if has_cookies else cookie_source.get("status", art_auth)},
            "cookieInjection": injection_status,
            "dreamyApiAuth": dreamy_api_auth_status(),
            "ffmpeg": media_export_status,
            "credentialSetup": credential_setup,
        },
    }


def adapter_auth_status(page_id: str) -> dict[str, Any]:
    if page_id == "myshell-art":
        cookie_source = cookie_source_status()
        has_cookies = cookie_source.get("status") == "ready"
        injection_status = cookie_injection_status(has_cookies, cookie_source)
        injection_state = str(injection_status.get("status") or "")
        cdp_status = (
            chrome_cdp_status()
            if has_cookies and injection_state == "ready"
            else {
                "status": "not_checked",
                "url": cdp_url(),
                "message": "Chrome CDP is checked after cookie injection succeeds",
            }
        )
        cdp_state = str(cdp_status.get("status") or "unknown")
        ready = has_cookies and injection_state == "ready" and cdp_state == "ok"
        message = str(injection_status.get("message") or "Set MYSHELL_COOKIES or myshell-cookies.json")
        if ready:
            message = "MyShell cookies are injected into Chrome and CDP is reachable"
        elif has_cookies and injection_state == "ready":
            message = str(cdp_status.get("message") or "Chrome CDP is unavailable")
        return {
            "status": "ready" if ready else "auth_missing",
            "mode": "browser-cookies",
            "message": message,
            "injectionStatus": injection_state,
            "cdpStatus": cdp_state,
            "cdpUrl": cdp_status.get("url", ""),
            "statusPath": injection_status.get("statusPath", ""),
        }
    if page_id == "dreamy-miniapp":
        return dreamy_api_auth_status()
    return {
        "status": "client_delegated",
        "mode": "telegram-init-data",
        "message": "Uses the authenticated Telegram miniapp browser session",
    }
