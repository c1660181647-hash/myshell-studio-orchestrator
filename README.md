# MyShell Studio Orchestrator

MyShell Studio Orchestrator is a unified agent dispatch center for Dreamy miniapp flows and MyShell Art pages. It routes natural-language creative requests into registered page adapters, tracks jobs and evidence, and keeps project timelines recoverable after backend restarts.

## What Is Included

- `/dreamy` Studio UI with conversation, preview timeline, canvas mode, mobile-ready page/agent selection, persisted job queue restore, cancel/retry, auth state, evidence status, and a return dock after cross-page dispatch.
- FastAPI backend with persistent Studio projects/jobs/evidence trails, SSE routing, and typed MyShell page/agent registries.
- Dreamy miniapp client executor for `generate`, `generate/result`, `task/running`, `task/cancel`, `task/retry`, and library-backed refresh flows.
- MyShell Art CDP adapter surface for browser-cookie-backed page execution. Missing cookies become `auth_missing`, not fake success.
- Navigation dispatch registry for the existing miniapp surfaces: Explore, AI Picks, Bot Detail, Upload, Tag Generator, Library, Library Detail, Energy Store, Energy History, Earn, Share Invite, Settings, Profile, and Checkin.
- Prompt-aware page routing: default Studio runs can infer page targets such as Library, Upload, Settings, Energy, Earn, or Checkin from natural language; explicit page selections still win.
- Manifest-driven page expansion via `orchestrator/backend/studio_pages_manifest.json` or `STUDIO_PAGES_MANIFEST`, so new MyShell miniapp surfaces can be added without changing Python router code.
- Health checks that report backend, storage, Chrome CDP, MyShell cookies, cookie injection, and Dreamy auth delegation separately, with the same status visible in Studio.
- Delivery readiness gates that combine health, registry coverage, dispatch preview, overview, MyShell Art auth, and job-store checks into a single Studio handoff status.
- Machine-readable delivery audit that packages readiness, dispatch matrix, coverage, handoff, downloadable bundle evidence, requirements, and artifacts into one acceptance payload.
- Project delivery reports that summarize accepted evidence, pending evidence, issue counts, unresolved actions, and per-segment evidence trails for operator handoff.
- Dispatch matrix coverage for every registered MyShell page, including executor, default agent, route path, missing route params, auth status, and recommended dispatch action.
- Batch dispatch planning for all ready MyShell targets, with openable navigation paths, executor groups, and explicit skip reasons for auth gaps or missing route params.
- Recoverable dispatch sessions that persist batch target progress, next openable target, visited/completed/skipped states, and queue recovery after refresh or cross-page navigation.
- One-click coverage verification for ready navigation surfaces, with accepted dispatch evidence for each verified page and explicit skip reasons for missing params, auth gaps, or non-batch-safe executors.
- Handoff snapshots that package health, readiness, overview, dispatch matrix, coverage, project delivery evidence, artifacts, gaps, and next actions into a single delivery decision.

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
- `POST /api/studio/dispatch-batch`
- `POST /api/studio/dispatch-sessions`
- `GET /api/studio/dispatch-sessions`
- `GET /api/studio/dispatch-sessions/{session_id}`
- `POST /api/studio/dispatch-sessions/{session_id}/targets/{target_id}`
- `GET /api/studio/coverage`
- `POST /api/studio/coverage/verify`
- `GET /api/studio/handoff-snapshot`
- `GET /api/studio/readiness`
- `GET /api/studio/delivery-audit`
- `POST /api/studio/actions/resolve`
- `POST /api/studio/actions/resolve-batch`
- `GET /api/studio/dispatch-preview`
- `POST /api/studio/run`
- `GET /api/studio/projects`
- `GET /api/studio/projects/{project_id}`
- `GET /api/studio/projects/{project_id}/delivery-report`
- `GET /api/studio/projects/{project_id}/delivery-bundle`
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

`/api/studio/dispatch-matrix` returns a full page-to-agent routing matrix for every registered MyShell surface. It includes the recommended action (`navigate`, `execute-client`, or `execute-server`), default agent id, executor, auth status, navigation path, route params, missing params, and readiness summary so operators can audit and launch dispatch targets from one panel. Pass `project_id` and optional `source_segment_id` to compute contextual routes from the current media segment, such as filling Tag Generator's required `img` parameter from an accepted image.

`POST /api/studio/dispatch-batch` turns the current dispatch matrix into an actionable batch plan without pretending to execute external adapters. Pass `project_id`, optional `source_segment_id`, optional `page_ids`, and optional `limit`. The response includes ready `targets`, `skippedTargets`, executor counts, navigation paths, source media context, the underlying matrix, and a fresh `handoffSnapshot`. The Studio UI exposes this as Plan All and Open Next so operators can move through all ready MyShell navigation targets while blocked client/server/auth/parameter targets stay visible.

`POST /api/studio/dispatch-sessions` persists a batch plan as a recoverable queue. It accepts the same `project_id`, optional `source_segment_id`, optional `page_ids`, and optional `limit` as dispatch batch, then returns `sessionId`, `status`, `summary.pending`, `summary.visited`, `summary.completed`, `targets`, `skippedTargets`, and `nextTarget`. `GET /api/studio/dispatch-sessions` restores recent queues, `GET /api/studio/dispatch-sessions/{session_id}` restores one queue, and `POST /api/studio/dispatch-sessions/{session_id}/targets/{target_id}` marks a target `visited`, `completed`, `skipped`, or `error`. Completing a navigation target writes accepted navigation job evidence with `dispatchSessionId` and `dispatchTargetId`, so coverage and handoff reports can prove the operator action. The Studio UI exposes this as Start Queue, Open Next, and Mark Done; Open Next records `visited` before leaving Studio, so returning to `/dreamy` can continue with the next pending navigation target instead of losing progress.

`/api/studio/coverage` turns the dispatch matrix and persisted job evidence into a page-level delivery report. It marks each MyShell surface as `covered`, `pending`, `ready_unverified`, or `blocked`, includes the latest job/evidence per page, and summarizes covered, unverified, pending, blocked, and issue counts for release handoff.

`POST /api/studio/coverage/verify` batch-verifies ready navigation pages for a project. It creates accepted navigation jobs for `ready_unverified` pages, reuses `project_id` and optional `source_segment_id` for contextual routes, and returns `createdCount`, `skippedPages`, touched jobs, the updated project, and refreshed coverage. Client and server executors are skipped with explicit reasons instead of being marked successful without a real adapter run.

`/api/studio/handoff-snapshot` packages the current delivery evidence into one operator-ready payload. Pass `project_id` and optional `source_segment_id` to include contextual routes and project delivery evidence. The response includes top-level `status`, `readyForDelivery`, `summary`, `gates`, `gaps`, `actions`, `artifacts`, and embedded `reports` for health, readiness, overview, dispatch matrix, coverage, and project delivery. Every artifact keeps its stable template `endpoint` and includes a concrete `url` with project/session/source context already filled in. Any blocked page, missing route parameter, auth gap, unresolved job action, or unverified surface stays visible as a gap/action instead of being treated as success.

`/api/studio/readiness` returns delivery gates for the handoff surface: backend, storage, Chrome CDP, cookie injection, page registry, agent registry, dispatch preview, overview, MyShell Art auth, and job store. Required gate failures make the response `blocked`; optional auth/CDP gaps are surfaced as `degraded` or `auth_missing` rather than hidden as success.

`/api/studio/delivery-audit` returns a machine-readable acceptance report for operators and deployment checks. Pass optional `project_id` and `source_segment_id` to include project-specific handoff evidence, and add `download=1` to receive a JSON attachment named `myshell-studio-audit-{project_id|current}.json`. The response includes top-level `status`, `summary`, `requirements`, `actions`, `artifacts`, and embedded `reports` for health, readiness, overview, dispatch matrix, coverage, project delivery, and handoff snapshot. Artifact entries include direct `url` values for reproducing each report or download without manually replacing `{project_id}` or `{session_id}` templates. The `actions` list lifts handoff gaps such as `restore-auth`, `verify-ready`, or `provide-project-id` into an operator queue. The Studio UI surfaces this as the Audit strip with refresh, action hints, and Audit JSON download actions.

`POST /api/studio/actions/resolve` turns one audit or handoff action into an executable result or explicit operator instruction. `verify-ready` runs targeted coverage verification for the page; auth, cookie, CDP, and project-selection actions return `manual_required` with the exact next step instead of pretending the external state changed.

`POST /api/studio/actions/resolve-batch` runs all supplied safe audit actions in one pass. It batch-executes `verify-ready` page actions, returns manual auth/CDP/project actions unchanged with instructions, and includes a refreshed audit so the Studio UI can update the action queue after one click.

`/api/studio/dispatch-preview` preflights a target page without creating a job. It returns the resolved page, executor, agent, auth status, navigation path, route params, and `missingRouteParams`, which lets the Studio UI show exactly where a dispatch will go before it runs.

`/api/studio/run` streams `meta`, `route`, `progress`, `execution_request`, `job`, `project`, and `done` events. Placeholder posters are always evidence-only drafts; generation completion requires fresh media, a task result, or an explicit failure/auth/timeout state. When no non-default page is selected, the intent router can infer registered miniapp pages directly from prompts like "open my generated library", "upload an image", or "go to settings". Navigation pages return `executor: "navigation"`, `clientAction: "navigate"`, and `navigationPath`; the Studio frontend executes the route switch, keeps a return dock available, and the backend stores accepted route evidence with `pageId`, `agentId`, `navigationPath`, and missing-parameter details.

If a navigation target is missing required route params, the `execution_request` includes `missingRouteParams`, the frontend stays in Studio, and the job records `error` evidence instead of marking the dispatch successful. This keeps contextual pages such as Tag Generator from being opened without required source media.

`/api/studio/projects` and `/api/studio/jobs` power restart recovery and queue views. Job responses include `evidenceTrail`, and retry responses include a client `executionRequest` when the adapter must run from the authenticated miniapp browser. The job queue supports `status`, `page_id`, and `agent_id` filters for the Studio dispatch center.

`/api/studio/projects/{project_id}/delivery-report` turns a persisted project into a handoff report with `handoffStatus`, `readyForHandoff`, status counts, accepted/pending/issue evidence counts, unresolved actions, and each segment's evidence trail. The Studio UI surfaces this as the Project Delivery strip above the page registry.

`/api/studio/projects/{project_id}/delivery-bundle` packages the current project into a single operator handoff payload. It includes the project delivery report, coverage report, handoff snapshot, recent dispatch sessions, accepted jobs, remaining targets, skipped targets, and artifact endpoints plus concrete artifact URLs for reproducing each report. Pass optional `source_segment_id` to keep contextual page routes and source-media coverage aligned with the active segment. Add `download=1` to return the JSON with an attachment filename of `myshell-studio-delivery-{project_id}.json`. The Studio UI exposes this from the Handoff strip as Bundle and downloads the same JSON handoff file after refresh.

`POST /api/studio/jobs/bulk` applies `cancel` or `retry` to filtered queue slices using the same `status`, `page_id`, `agent_id`, and `project_id` filters. Bulk cancel skips terminal `done` and `cancelled` jobs by default unless `include_terminal` is set. It returns updated jobs, skipped jobs, touched projects, and retry execution requests when adapter execution must resume.

Contextual miniapp pages receive route parameters automatically: Bot Detail, Upload, and Tag Generator include the selected `slug_id`; Tag Generator also carries source media as `img` when the dispatch starts from an existing segment. Dynamic path pages can declare placeholders such as `/library/:id`; Studio replaces the placeholder from `routeDefaults` before dispatch and only reports `missingRouteParams` when the placeholder or query value cannot be resolved.

`/api/studio/run` also accepts `agent_id`. When provided and registered, that agent id is echoed in `route`, persisted on the job, returned in `execution_request`, and preserved through retry so operators can intentionally dispatch through a specific Studio agent.

To add a MyShell page, append a manifest entry with `id`, `name`, `appRoute`, `capabilities`, optional `routeParams`, optional `routeDefaults`, and optional `intentKeywords`. `routeDefaults` are merged into the navigation query string unless the route uses a matching path placeholder such as `:id`, in which case Studio replaces that placeholder. This lets a page carry fixed parameters such as source, tab, page mode, referral context, or detail ids without Python changes. For deployment-specific page sets, point `STUDIO_PAGES_MANIFEST` at another JSON file with the same shape.

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
