# MyShell Studio Orchestrator

MyShell Studio Orchestrator is a unified agent dispatch center for Dreamy miniapp flows and MyShell Art pages. It routes natural-language creative requests into registered page adapters, tracks jobs and evidence, and keeps project timelines recoverable after backend restarts.

## What Is Included

- `/dreamy` Studio UI with conversation, preview timeline, canvas mode, page adapter selection, persisted job queue restore, cancel/retry, auth state, and evidence status.
- FastAPI backend with persistent Studio projects/jobs/evidence trails, SSE routing, and typed MyShell page/agent registries.
- Dreamy miniapp client executor for `generate`, `generate/result`, `task/running`, `task/cancel`, `task/retry`, and library-backed refresh flows.
- MyShell Art CDP adapter surface for browser-cookie-backed page execution. Missing cookies become `auth_missing`, not fake success.
- Health checks that report backend, storage, Chrome CDP, MyShell cookies, and Dreamy auth delegation separately.

## Repository Layout

- `frontend/` - Vite + React miniapp frontend.
- `orchestrator/backend/` - FastAPI backend, Studio API, registries, SQLite job store, and CDP bridge.
- `orchestrator/Dockerfile` - Cloud Run image that builds the root frontend and backend together.

## Local Run

Backend:

```bash
cd orchestrator/backend
python -m pip install -r requirements.txt
PORT=8090 python main.py
```

Frontend:

```bash
cd frontend
npm install
VITE_DREAMY_ORCHESTRATOR_BASE_URL=http://127.0.0.1:8090 npm run dev -- --host 0.0.0.0 --port 5174
```

Open:

```text
http://127.0.0.1:5174/?test_route=dreamy
```

## Studio APIs

- `GET /api/health`
- `GET /api/pages`
- `GET /api/agents`
- `POST /api/studio/run`
- `GET /api/studio/projects`
- `GET /api/studio/projects/{project_id}`
- `POST /api/studio/projects/{project_id}/client-result`
- `POST /api/studio/projects/{project_id}/reset`
- `GET /api/studio/jobs`
- `GET /api/studio/jobs/{job_id}`
- `GET /api/studio/jobs/{job_id}/evidence`
- `POST /api/studio/jobs/{job_id}/cancel`
- `POST /api/studio/jobs/{job_id}/retry`

`/api/studio/run` streams `meta`, `route`, `progress`, `execution_request`, `job`, `project`, and `done` events. Placeholder posters are always evidence-only drafts; completion requires fresh media, a task result, or an explicit failure/auth/timeout state.

`/api/studio/projects` and `/api/studio/jobs` power restart recovery and queue views. Job responses include `evidenceTrail`, and retry responses include a client `executionRequest` when the adapter must run from the authenticated miniapp browser.

## Environment

Copy the example files and fill local values:

- `frontend/.env.example`
- `orchestrator/.env.example`

Important backend settings:

- `STUDIO_STORE_PATH` - SQLite path for project/job/evidence persistence. Defaults to `orchestrator/backend/.studio/studio.sqlite3`.
- `MYSHELL_COOKIES` - JSON cookie array for MyShell Art CDP execution. If omitted, MyShell Art jobs report `auth_missing`.
- `MYSHELL_CDP_URL` - Chrome DevTools endpoint, default `http://127.0.0.1:9222`.
- `STUDIO_ROUTER_MODE=local|gemini` - local catalog matching by default; Gemini requires `GEMINI_API_KEY`.

## Verification

Frontend:

```bash
cd frontend
npm run build
```

Backend:

```bash
cd orchestrator
python -m unittest discover -s backend/tests -v
```

Cloud Run build from repository root:

```bash
gcloud builds submit --config orchestrator/cloudbuild.yaml .
```
