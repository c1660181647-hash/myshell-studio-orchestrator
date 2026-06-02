"""
Art Chat Orchestrator — FastAPI Backend
主服务入口：SSE 流式对话 + Prompt Gallery API
"""

import json
import uuid
import os
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, StreamingResponse
from sse_starlette.sse import EventSourceResponse

from orchestrator import orchestrate_stream
from bot_catalog import MYSHELL_BOTS, PROMPT_GALLERY, get_bots_by_type
from bot_previews import list_bot_previews, load_preview_manifest, preview_for_bot
from studio import register_studio_routes
from studio_runtime import runtime_health
from studio_store import STUDIO_STORE


app = FastAPI(title="Art Chat Orchestrator", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory conversation store (demo)
conversations: dict = {}


@app.get("/api/health")
async def health():
    return await runtime_health(STUDIO_STORE.path)


@app.post("/api/chat")
async def chat(
    message: str = Form(...),
    conversation_id: Optional[str] = Form(None),
    image: Optional[UploadFile] = File(None)
):
    """Main chat endpoint - returns SSE stream"""
    
    if not conversation_id:
        conversation_id = str(uuid.uuid4())
    
    # Read image if provided
    image_data = None
    if image:
        content = await image.read()
        import base64
        image_data = base64.b64encode(content).decode()
    
    # Store message in conversation
    if conversation_id not in conversations:
        conversations[conversation_id] = {
            "id": conversation_id,
            "messages": [],
            "created_at": datetime.utcnow().isoformat()
        }
    
    conversations[conversation_id]["messages"].append({
        "role": "user",
        "content": message,
        "has_image": image_data is not None,
        "timestamp": datetime.utcnow().isoformat()
    })
    
    async def event_generator():
        # Send conversation ID first
        yield {
            "event": "meta",
            "data": json.dumps({"conversation_id": conversation_id})
        }
        
        # Stream orchestration events with keepalive
        last_event_time = datetime.utcnow()
        async for event in orchestrate_stream(message, conversation_id, image_data):
            event_type = event.get("type", "thinking")
            yield {
                "event": event_type,
                "data": json.dumps(event, ensure_ascii=False)
            }
            last_event_time = datetime.utcnow()
        
        yield {
            "event": "done",
            "data": json.dumps({"status": "complete"})
        }
    
    return EventSourceResponse(
        event_generator(),
        ping=15,  # Send SSE comment every 15s to keep connection alive
        ping_message_factory=lambda: "keepalive"
    )


@app.get("/api/gallery")
async def get_gallery(category: Optional[str] = None, limit: int = 12):
    """Get prompt gallery items"""
    items = PROMPT_GALLERY
    if category and category != "全部":
        items = [p for p in items if p["category"] == category]
    return {
        "items": items[:limit],
        "categories": list(set(p["category"] for p in PROMPT_GALLERY))
    }


@app.get("/api/bots")
async def get_bots(type: Optional[str] = None):
    """Get available bots. Optional filter: type=text-to-image|image-to-image|image-to-video"""
    bots = get_bots_by_type(type) if type else MYSHELL_BOTS
    preview_manifest = list_bot_previews()
    preview_source_manifest = load_preview_manifest()
    return {
        "total": len(bots),
        "bots": [
            {
                "slug": b["slug"],
                "name": b["name"],
                "icon": b["icon"],
                "type": b["type"],
                "description": b["desc"],
                "rating": b["rating"],
                "gen_button": b.get("gen_button", ""),
                "page_url": f"https://art.myshell.ai/creative/{b['slug']}",
                "keywords": b.get("keywords", []),
                "preview": preview_for_bot({**b, "pageId": "myshell-art"}, preview_source_manifest),
            }
            for b in bots
        ],
        "previews": {
            "version": preview_manifest["version"],
            "source": preview_manifest["source"],
            "generatedAt": preview_manifest["generatedAt"],
            "summary": preview_manifest["summary"],
        },
        "summary": {
            "text-to-image": len(get_bots_by_type("text-to-image")),
            "image-to-image": len(get_bots_by_type("image-to-image")),
            "image-to-video": len(get_bots_by_type("image-to-video")),
        }
    }


@app.get("/api/conversations/{conversation_id}")
async def get_conversation(conversation_id: str):
    """Get conversation history"""
    if conversation_id not in conversations:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversations[conversation_id]


register_studio_routes(app)


# Serve frontend static files
# Frontend paths — works locally from the monorepo and in Docker (/app/ dir)
_base = os.path.dirname(os.path.abspath(__file__))


def _first_existing_path(*paths: str) -> str:
    for path in paths:
        if os.path.exists(path):
            return path
    return paths[0]


frontend_dist = _first_existing_path(
    os.path.join(_base, "..", "..", "frontend", "dist"),
    os.path.join(_base, "..", "frontend", "dist"),
    os.path.join(_base, "frontend", "dist"),
)
frontend_public = _first_existing_path(
    os.path.join(_base, "..", "..", "frontend", "public"),
    os.path.join(_base, "..", "frontend", "public"),
    os.path.join(_base, "frontend", "public"),
)

if os.path.exists(frontend_dist):
    assets_dir = os.path.join(frontend_dist, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

# Serve generated images — public/generated in local dev, dist/generated in Docker.
generated_dir = _first_existing_path(
    os.path.join(frontend_public, "generated"),
    os.path.join(frontend_dist, "generated"),
)
os.makedirs(generated_dir, exist_ok=True)
app.mount("/generated", StaticFiles(directory=generated_dir), name="generated")

# Serve gallery images — try public/gallery first (local dev), then dist/gallery (Docker)
gallery_dir = os.path.join(frontend_public, "gallery")
if not os.path.exists(gallery_dir):
    gallery_dir = os.path.join(frontend_dist, "gallery")
if os.path.exists(gallery_dir):
    app.mount("/gallery", StaticFiles(directory=gallery_dir), name="gallery")

# Catch-all for SPA
@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    if os.path.exists(frontend_dist):
        index_path = os.path.join(frontend_dist, "index.html")
        if os.path.exists(index_path):
            with open(index_path, "r") as f:
                return HTMLResponse(f.read())
    return HTMLResponse("<h1>Frontend not built</h1>")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8090))
    uvicorn.run(app, host="0.0.0.0", port=port)
