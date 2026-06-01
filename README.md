# MyShell Studio Orchestrator

MyShell Studio Orchestrator is a unified agent dispatch center for Dreamy miniapp flows and MyShell Art pages. It routes natural-language creative requests into registered page adapters, tracks jobs and evidence, and keeps project timelines recoverable after backend restarts.

## What Is Included

- `/dreamy` Studio UI with conversation, preview timeline, canvas mode, mobile-ready page/agent selection, persisted job queue restore, cancel/retry, auth state, evidence status, and a return dock after cross-page dispatch.
- FastAPI backend with persistent Studio projects/jobs/evidence trails, SSE routing, and typed MyShell page/agent registries.
- Dreamy miniapp client executor for `generate`, `generate/result`, `task/running`, `task/cancel`, `task/retry`, and library-backed refresh flows.
- MyShell Art CDP adapter surface for browser-cookie-backed page execution. Missing cookies become `auth_missing`, not fake success.
- Navigation dispatch registry for the existing miniapp surfaces: Explore, AI Picks, Bot Detail, Upload, Tag Generator, Library, Energy Store, Earn, Share Invite, Settings, and Checkin.
- Prompt-aware page routing: default Studio runs can infer page targets such as Library, Upload, Settings, Energy, Earn, or Checkin from natural language; explicit page selections still win.
- Manifest-driven page expansion via `orchestrator/backend/studio_pages_manifest.json` or `STUDIO_PAGES_MANIFEST`, so new MyShell miniapp surfaces can be added without changing Python router code.
- Health checks that report backend, storage, Chrome CDP, MyShell cookies, cookie injection, and Dreamy auth delegation separately, with the same status visible in Studio.
- Delivery readiness gates that combine health, registry coverage, dispatch preview, overview, MyShell Art auth, and job-store checks into a single Studio handoff status.
- Project delivery reports that summarize accepted evidence, pending evidence, issue counts, unresolved actions, and per-segment evidence trails for operator handoff.
- Dispatch matrix coverage for every registered MyShell page, including executor, default agent, route path, missing route params, auth status, and recommended dispatch action.

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
- `GET /api/studio/overview`
- `GET /api/studio/dispatch-matrix`
- `GET /api/studio/readiness`
- `GET /api/studio/dispatch-preview`
- `POST /api/studio/run`
- `GET /api/studio/projects`
- `GET /api/studio/projects/{project_id}`
- `GET /api/studio/projects/{project_id}/delivery-report`
- `POST /api/studio/projects/{project_id}/client-result`
- `POST /api/studio/projects/{project_id}/reset`
- `GET /api/studio/jobs`
- `POST /api/studio/jobs/bulk`
- `GET /api/studio/jobs/{job_id}`
- `GET /api/studio/jobs/{job_id}/evidence`
- `POST /api/studio/jobs/{job_id}/cancel`
- `POST /api/studio/jobs/{job_id}/retry`

`/api/pages` returns registry metadata plus runtime `authStatus`, `dispatchReady`, `dispatchStatus`, and `dispatchMessage` for each MyShell page, so operators can tell whether a page is ready, client-delegated, or blocked by missing credentials before dispatch.

`/api/studio/overview` aggregates pages, agents, latest jobs, and status counts for the Studio command center. Page summaries include runtime readiness, related agent ids, per-status job counts, and the latest job for that page.

`/api/studio/dispatch-matrix` returns a full page-to-agent routing matrix for every registered MyShell surface. It includes the recommended action (`navigate`, `execute-client`, or `execute-server`), default agent id, executor, auth status, navigation path, route params, missing params, and readiness summary so operators can audit all dispatch targets at once.

`/api/studio/readiness` returns delivery gates for the handoff surface: backend, storage, Chrome CDP, cookie injection, page registry, agent registry, dispatch preview, overview, MyShell Art auth, and job store. Required gate failures make the response `blocked`; optional auth/CDP gaps are surfaced as `degraded` or `auth_missing` rather than hidden as success.

`/api/studio/dispatch-preview` preflights a target page without creating a job. It returns the resolved page, executor, agent, auth status, navigation path, route params, and `missingRouteParams`, which lets the Studio UI show exactly where a dispatch will go before it runs.

`/api/studio/run` streams `meta`, `route`, `progress`, `execution_request`, `job`, `project`, and `done` events. Placeholder posters are always evidence-only drafts; generation completion requires fresh media, a task result, or an explicit failure/auth/timeout state. When no non-default page is selected, the intent router can infer registered miniapp pages directly from prompts like "open my generated library", "upload an image", or "go to settings". Navigation pages return `executor: "navigation"`, `clientAction: "navigate"`, and `navigationPath`; the Studio frontend executes the route switch, keeps a return dock available, and the backend stores accepted route evidence.

`/api/studio/projects` and `/api/studio/jobs` power restart recovery and queue views. Job responses include `evidenceTrail`, and retry responses include a client `executionRequest` when the adapter must run from the authenticated miniapp browser. The job queue supports `status`, `page_id`, and `agent_id` filters for the Studio dispatch center.

`/api/studio/projects/{project_id}/delivery-report` turns a persisted project into a handoff report with `handoffStatus`, `readyForHandoff`, status counts, accepted/pending/issue evidence counts, unresolved actions, and each segment's evidence trail. The Studio UI surfaces this as the Project Delivery strip above the page registry.

`POST /api/studio/jobs/bulk` applies `cancel` or `retry` to filtered queue slices using the same `status`, `page_id`, `agent_id`, and `project_id` filters. Bulk cancel skips terminal `done` and `cancelled` jobs by default unless `include_terminal` is set. It returns updated jobs, skipped jobs, touched projects, and retry execution requests when adapter execution must resume.

Contextual miniapp pages receive route parameters automatically: Bot Detail, Upload, and Tag Generator include the selected `slug_id`; Tag Generator also carries source media as `img` when the dispatch starts from an existing segment.

`/api/studio/run` also accepts `agent_id`. When provided and registered, that agent id is echoed in `route`, persisted on the job, returned in `execution_request`, and preserved through retry so operators can intentionally dispatch through a specific Studio agent.

To add a MyShell page, append a manifest entry with `id`, `name`, `appRoute`, `capabilities`, optional `routeParams`, optional `routeDefaults`, and optional `intentKeywords`. `routeDefaults` are merged into the navigation query string, which lets a page carry fixed parameters such as source, tab, page mode, or referral context without Python changes. For deployment-specific page sets, point `STUDIO_PAGES_MANIFEST` at another JSON file with the same shape.

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
