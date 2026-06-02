# Orchestrator Backend

The backend exposes the Studio API for MyShell page and agent dispatch. It keeps projects, segments, jobs, auth status, and evidence trails in a SQLite store so a backend restart can recover active Studio state.

## Core Surfaces

- `GET /api/health` reports backend, SQLite storage, Chrome CDP, MyShell cookie, cookie injection, and Dreamy delegated-auth state.
- `GET /api/pages` lists registered page adapters and miniapp navigation surfaces, including `dreamy-miniapp`, `myshell-art`, Explore, AI Picks, Bot Detail, Upload, Tag Generator, Library, Library Detail, Energy, Energy History, Earn, Share Invite, Settings, Profile, and Checkin.
- `GET /api/studio/readiness` includes a `page-registry` route coverage evidence block that compares registered `appRoute` values with the frontend `<Route>` paths when the App source is available. Missing or extra production routes block readiness; missing source is reported as `source_unavailable` without blocking runtime startup.
- `GET /api/agents` lists the dispatch graph agents.
- `POST /api/studio/run` routes a prompt, creates a persisted job, and streams Studio SSE events.
- `GET /api/studio/delivery-audit` returns machine-readable acceptance status, requirements, de-duplicated operator `actions` from both readiness fixes and handoff gaps, artifacts, and embedded reports for deployment handoff. Pending dispatch session targets are promoted as executable `run-target` actions, cancelled dispatch targets are promoted as safe `retry-queue` actions, and dispatch targets marked `visited` or `error` are promoted into handoff/audit operator actions with Studio `uiUrl` values for exact `/dreamy` restore. Manual and retry actions include a materialized `next` instruction with concrete operator `url`/`retryUrl`/`cancelUrl`/`uiUrl` values where applicable. Artifacts include both stable template `endpoint` values and concrete `url` values with project/session/source context filled in. Add `download=1` to receive `myshell-studio-audit-{project_id|current}.json` as a JSON attachment.
- `POST /api/studio/actions/resolve` executes safe audit actions such as targeted `verify-ready` and dispatch-session `run-target`, or returns explicit `manual_required` instructions with concrete `url`/`retryUrl`/`cancelUrl` values for every handoff/audit operator action. Dispatch target actions can include `session_id`, which resolves to the exact dispatch session API `url` plus `target_id` and a Studio `uiUrl` for `/dreamy` target restore.
- `POST /api/studio/actions/resolve-batch` executes multiple safe audit actions, including `verify-ready` coverage checks, dispatch-session `run-target` actions, and cancelled-session `retry-queue` actions, preserves every manual operator action with instructions, and returns a refreshed audit. Batch `run-target` entries include the dispatch target run result so the Studio UI can continue into client execution requests.
- `POST /api/studio/dispatch-batch` and `POST /api/studio/dispatch-sessions` accept `exclude_covered=true` for resume mode. Covered pages are skipped with `reason: "already_covered"` and `summary.coveredSkipped`, so operators can plan all pages or only the remaining unverified surfaces.
- `GET /api/studio/dispatch-sessions/{session_id}` restores one recoverable dispatch queue and accepts `target_id` to return `focusedTargetId`, `focusedTargetIndex`, and `focusedTarget` for exact handoff inspection links. The Studio UI accepts `/dreamy?dispatch_session_id={session_id}&target_id={target_id}` or `/dreamy?session_id={session_id}&target_id={target_id}` to restore and highlight that exact target. `POST /api/studio/dispatch-sessions/{session_id}/cancel` marks unfinished targets `cancelled`, `POST /api/studio/dispatch-sessions/{session_id}/retry` reopens `cancelled` and `error` targets, `POST /api/studio/dispatch-sessions/{session_id}/targets/{target_id}/run` turns a queued target into a navigation handoff or adapter `executionRequest`, and `POST /api/studio/dispatch-sessions/{session_id}/targets/{target_id}` marks a target `visited`, `completed`, `skipped`, or `error`. Dreamy client target runs carry `dispatchSessionId` and `dispatchTargetId` through `/client-result`, so successful client media automatically completes the target. The Studio UI exposes Cancel Queue, Retry Queue, Run Next, Done, Error, and Skip controls for queue targets.
- `GET /api/studio/projects` lists recent persisted projects for Studio restore.
- `GET /api/studio/projects/{project_id}/delivery-bundle?download=1` returns the operator handoff bundle as a downloadable JSON attachment. Bundle artifacts include session-level restore links and target-level `target_id` restore links for exact page handoff inspection. Dispatch artifacts keep API `url` values and include Studio-facing `uiUrl` values that open `/dreamy` with the matching session and target. Bundle `remainingTargets` includes both `pending` and `visited` dispatch targets, so opened-but-uncompleted pages stay visible during handoff. Bundle `skippedTargets` includes both plan-time skips and operator-skipped dispatch targets, `errorTargets` lists dispatch targets that need operator review, and `summary.cancelledTargets` keeps cancelled queue scope visible for retry/resume decisions.
- `GET /api/studio/jobs` lists the persisted queue with optional `project_id` and `status` filters.
- `GET /api/studio/jobs/{job_id}` and `/evidence` return current state plus evidence history.
- `POST /api/studio/jobs/{job_id}/cancel` and `/retry` manage persisted jobs. Retry returns an `executionRequest` for client-side miniapp execution when needed.

When `/api/studio/run` receives the default Dreamy page selection, the backend can infer registered miniapp navigation targets from the prompt, for example Library, Upload, Tag Generator, Settings, Energy, Earn, Share Invite, Explore, AI Picks, Bot Detail, or Checkin. Explicit non-default `page_id` values always take priority over prompt inference.

`POST /api/studio/run` accepts optional `agent_id`. Registered agent ids are persisted on the job and included in route/execution/retry payloads; unknown ids fall back to the default executor agent for the selected page.

Miniapp navigation pages are loaded from `backend/studio_pages_manifest.json`. Set `STUDIO_PAGES_MANIFEST=/path/to/pages.json` to extend or replace the page set per environment. Manifest entries support `id`, `name`, `appRoute`, `capabilities`, optional `routeParams`, optional `routeDefaults`, and optional `intentKeywords`; matching intent keywords join the same prompt router used by the default page selection. `routeDefaults` are merged into the generated navigation query before dynamic values like `slug_id` and `img`, unless a route uses a matching path placeholder such as `/library/:id`, in which case Studio replaces the placeholder before computing `missingRouteParams`. Set `STUDIO_FRONTEND_APP_ROUTES_FILE=/path/to/App.tsx` when the frontend route source is outside the default repository layout and should be included in readiness route coverage.

## Evidence Rules

The backend never marks placeholder media as complete. Generation `done` is accepted only when a fresh media URL or task result is registered. Navigation pages complete with accepted route evidence and return `clientAction: navigate` plus `navigationPath` for the Studio frontend to execute while keeping the return dock available. Missing cookies become `auth_missing`; long-running or failed adapters become `timeout` or `error`.

Contextual navigation pages can declare `routeParams`. The current registry uses this to append `slug_id` for Bot Detail, Upload, and Tag Generator, add `img` for Tag Generator when source media exists, and replace the `id` path parameter for Library Detail.

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
