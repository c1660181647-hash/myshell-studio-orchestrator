# Orchestrator Backend

The backend exposes the Studio API for MyShell page and agent dispatch. It keeps projects, segments, jobs, auth status, and evidence in a SQLite store so a backend restart can recover active Studio state.

## Core Surfaces

- `GET /api/health` reports backend, SQLite storage, Chrome CDP, MyShell cookie, and Dreamy delegated-auth state.
- `GET /api/pages` lists registered page adapters: `dreamy-miniapp` and `myshell-art`.
- `GET /api/agents` lists the dispatch graph agents.
- `POST /api/studio/run` routes a prompt, creates a persisted job, and streams Studio SSE events.
- `GET /api/studio/jobs/{job_id}` plus `cancel` and `retry` manage persisted jobs.

## Evidence Rules

The backend never marks placeholder media as complete. `done` is accepted only when a fresh media URL or task result is registered. Missing cookies become `auth_missing`; long-running or failed adapters become `timeout` or `error`.

## Local Backend

```bash
cd orchestrator/backend
python -m pip install -r requirements.txt
PORT=8090 python main.py
```

## MyShell Art CDP

Start Chrome with remote debugging and provide cookies:

```bash
google-chrome-stable --remote-debugging-port=9222 --user-data-dir=/tmp/myshell-chrome
export MYSHELL_COOKIES='[{"name":"...","value":"...","domain":".myshell.ai"}]'
```

Without cookies, MyShell Art jobs are visible in Studio but stop as `auth_missing`.

## Tests

```bash
cd orchestrator
python -m unittest discover -s backend/tests -v
```
