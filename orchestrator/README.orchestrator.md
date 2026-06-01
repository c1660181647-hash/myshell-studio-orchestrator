# art-chat-orchestrator

> AI-powered chat orchestrator for [art.myshell.ai](https://art.myshell.ai) — understands creative requests in any language, routes them to the best specialized bot, and streams real-time generation progress.

## Overview

**art-chat-orchestrator** is a full-stack web application that acts as an intelligent front-end for MyShell Art. Users describe what they want to create in natural language (any language), and the orchestrator:

1. Analyzes intent using **Gemini 2.5 Flash**
2. Selects the optimal bot from a catalog of 10 specialized image-generation bots using a weighted scoring algorithm
3. Optimizes the prompt for the selected bot
4. Generates the image and streams each step back to the UI in real time

The result is a transparent, conversational creative workflow — users see exactly what the AI is thinking at every stage.

## Features

- **Multi-language intent recognition** — submit prompts in any language; the system produces optimized English prompts for generation
- **Smart bot routing** — 10 specialized bots selected by a weighted algorithm: 40% capability match, 20% rating, 20% speed, 20% success rate
- **Real-time thinking log** — SSE stream shows each step (understanding → matching → preparing → generating → completed) live in the UI
- **Image upload support** — attach a reference image for style transfer, image editing, or image-to-image generation
- **Prompt gallery** — 12 curated templates across 7 categories (Portrait, Anime, 3D, Style, Creative, Logo, Video) with one-click use
- **Dark-themed responsive UI** — React 19 + Tailwind CSS 4, matching MyShell Art's design language

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python · FastAPI · Uvicorn · sse-starlette |
| AI | Google Gemini 2.5 Flash (intent) · Gemini 2.5 Flash Image (generation) |
| Frontend | React 19 · Vite 8 · Tailwind CSS 4 |
| HTTP | httpx (async) · python-multipart |

## Requirements

- Python 3.10+
- Node.js 18+
- A [Google Gemini API key](https://aistudio.google.com/app/apikey)

## Installation & Setup

```bash
git clone https://github.com/Arxchibobo/art-chat-orchestrator.git
cd art-chat-orchestrator
```

### Option 1 — Start script (recommended)

```bash
export GEMINI_API_KEY="your_gemini_api_key"
chmod +x start.sh
./start.sh
```

Alternatively, store the key in `~/.openclaw/personal-secrets.json`:

```json
{
  "GEMINI_API_KEY": "your_gemini_api_key"
}
```

### Option 2 — Manual setup

```bash
# Backend
cd backend
pip install -r requirements.txt
GEMINI_API_KEY=your_key python3 main.py

# Frontend (separate terminal)
cd frontend
npm install
npm run build        # production build, served by backend at :8090
# or: npm run dev    # dev server at :3090 with proxy to backend
```

The application is available at **http://localhost:8090**.

## Usage

1. Open http://localhost:8090 in your browser
2. Type a creative request in any language, or pick a template from the **Prompt Gallery**
3. Optionally attach a reference image for style transfer or image-to-image tasks
4. Watch the thinking log as the orchestrator selects a bot and generates your image
5. Download the result, or click **Regenerate** / **Restyle** to iterate

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/chat` | `POST` (FormData) | Main endpoint — streams SSE thinking log + final image |
| `/api/gallery` | `GET` | Prompt gallery items, filterable by `?category=` |
| `/api/bots` | `GET` | List all available bots and their metadata |
| `/api/health` | `GET` | Health check |

### SSE stream format (`/api/chat`)

```
event: meta
data: {"conversation_id": "uuid"}

event: thinking
data: {"step": "understanding", "icon": "🔍", "message": "Analyzing your request..."}

event: thinking
data: {"step": "matching", "icon": "🤖", "message": "Selected: Anime Art Master ⭐4.7", "bot": {...}}

event: thinking
data: {"step": "generating", "eta_seconds": 15}

event: result
data: {"image_base64": "...", "bot_used": {...}, "prompt_used": "..."}

event: done
data: {"status": "complete"}
```

## Bot Catalog

| Bot | Specialty | Capabilities | Rating |
|-----|-----------|--------------|--------|
| 📸 AI Photo Studio | Realistic photography | text-to-image | 4.8 |
| 🎌 Anime Art Master | Anime & manga | text-to-image, image-to-image | 4.7 |
| 🌈 Creative Canvas | Surreal & fantasy | text-to-image | 4.7 |
| 🎨 Style Transformer | Style transfer | image-to-image, style-transfer | 4.6 |
| ✂️ Smart Editor | Image editing & inpainting | image-edit, remove-bg | 4.6 |
| 💎 Logo Studio | Logo & brand identity | text-to-image | 4.5 |
| 🪄 Face Magic | Face swap | face-swap, image-to-image | 4.5 |
| 🧊 3D Vision | 3D renders | text-to-image, text-to-3d | 4.4 |
| 🎬 Video Creator | AI video generation | text-to-video, image-to-video | 4.3 |
| 💬 Comic Factory | Comic strips | text-to-image, multi-image | 4.3 |

## Configuration

| Setting | Location | Default | Description |
|---------|----------|---------|-------------|
| `GEMINI_API_KEY` | env var or `~/.openclaw/personal-secrets.json` | — | **Required.** Google Gemini API key |
| Backend port | `backend/main.py` | `8090` | Port the server listens on |
| Frontend dev port | `frontend/vite.config.js` | `3090` | Vite HMR dev server port |
| Gallery limit | `backend/main.py` | `12` | Max gallery items per request |
| Bot catalog | `backend/bot_catalog.py` | 10 bots | Edit inline to add or modify bots |
| Gallery items | `backend/bot_catalog.py` | 12 items | Edit inline to add or modify templates |

## Project Structure

```
art-chat-orchestrator/
├── start.sh                    # Unified startup script
├── backend/
│   ├── main.py                 # FastAPI server & API endpoints
│   ├── orchestrator.py         # Intent recognition, bot routing, image generation
│   ├── bot_catalog.py          # Bot definitions & prompt gallery data
│   ├── myshell_bridge.py       # Optional Chrome CDP bridge for MyShell Art
│   └── requirements.txt
└── frontend/
    ├── vite.config.js
    ├── public/gallery/          # Gallery preview images
    └── src/
        ├── App.jsx              # Root component & SSE client
        ├── index.css            # Global styles & animations
        └── components/
            ├── ChatInput.jsx    # Text + image input
            ├── ChatMessages.jsx # Thinking log & result display
            └── PromptGallery.jsx
```
