# Dreamy Studio Orchestrator

Unified Dreamy Studio entry for natural-language creative routing, segment-based video material staging, and collapsed agent orchestration.

## Structure

- `frontend/` - Dreamy miniapp frontend with the new `/dreamy` two-panel Studio UI.
- `orchestrator/backend/` - FastAPI backend with the Studio SSE API and in-memory project/session state.
- `orchestrator/docs/` - source notes from the art chat orchestrator repo.

## What is included

- Player mode: chat-led next-step loop for generate, extend, restyle, source reuse, and retry-agent actions.
- Canvas mode: editable linear agent chain exposed through the collapsed Agents drawer.
- Studio APIs:
  - `POST /api/studio/run`
  - `GET /api/studio/projects/{project_id}`
  - `POST /api/studio/projects/{project_id}/client-result`
  - `POST /api/studio/projects/{project_id}/reset`
- Client executor path for Dreamy miniapp API calls.
- Server route memory for projects and segment timelines.

V1 stages video as appendable segments. It does not concatenate final MP4 files and does not persist projects after backend restart.

## Local Run

Backend:

```powershell
cd orchestrator\backend
python -m pip install -r requirements.txt
$env:PORT = "8090"
python main.py
```

Frontend:

```powershell
cd frontend
npm install
$env:VITE_DREAMY_ORCHESTRATOR_BASE_URL = "http://127.0.0.1:8090"
npm run dev -- --host 0.0.0.0 --port 5174
```

Open:

```text
http://127.0.0.1:5174/?test_route=dreamy
```

## Environment

Copy the example files and fill values locally:

- `frontend/.env.example`
- `orchestrator/.env.example`

No Gemini, MyShell, Dreamy, GitHub, or Cloudflare secret is committed in this repository.

## Verification

Frontend:

```powershell
cd frontend
npm run build
```

Backend:

```powershell
cd orchestrator
python -m unittest discover -s backend\tests -v
```
