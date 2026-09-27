import os
import sys
import json
import uuid
import asyncio
import subprocess
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

app = FastAPI(
    title="CineVoice Render API",
    description="Backend rendering and voiceover synthesis service for CineVoice Studio",
    version="1.0.0"
)

# Enable CORS for Vercel, localhost, and all external clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "rendered_outputs")
os.makedirs(OUTPUT_DIR, exist_ok=True)

class SceneItem(BaseModel):
    id: int
    vo: Optional[str] = ""
    subtitle: Optional[str] = ""
    title: Optional[str] = None

class RenderRequest(BaseModel):
    voice: Optional[str] = "male"  # "male" or "female"
    scenes: Optional[List[Dict[str, Any]]] = None

# Active rendering jobs tracking
JOB_STATUS: Dict[str, Dict[str, Any]] = {}

@app.get("/")
@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "service": "CineVoice Render API",
        "version": "1.0.0",
        "active_jobs": len(JOB_STATUS)
    }

def run_render_task(job_id: str, voice: str, scenes: Optional[List[Dict[str, Any]]]):
    try:
        JOB_STATUS[job_id]["status"] = "processing"
        script_arg = []
        temp_script_path = None

        if scenes:
            temp_script_path = os.path.join(OUTPUT_DIR, f"script_{job_id}.json")
            with open(temp_script_path, "w", encoding="utf-8") as f:
                json.dump(scenes, f)
            script_arg = ["--script", temp_script_path]

        out_filename = f"cinevoice_{job_id}.mp4"
        out_filepath = os.path.join(OUTPUT_DIR, out_filename)

        cmd = [
            sys.executable,
            "render_movie.py",
            "--voice", voice,
            "--out", out_filepath,
            *script_arg
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True
        )

        # Cleanup temp script
        if temp_script_path and os.path.exists(temp_script_path):
            os.remove(temp_script_path)

        if os.path.exists(out_filepath):
            JOB_STATUS[job_id]["status"] = "completed"
            JOB_STATUS[job_id]["video_file"] = out_filename
            JOB_STATUS[job_id]["video_url"] = f"/api/download/{out_filename}"
        else:
            JOB_STATUS[job_id]["status"] = "failed"
            JOB_STATUS[job_id]["error"] = "Output file was not generated."

    except subprocess.CalledProcessError as e:
        JOB_STATUS[job_id]["status"] = "failed"
        JOB_STATUS[job_id]["error"] = f"Render error: {e.stderr or e.stdout or str(e)}"
    except Exception as e:
        JOB_STATUS[job_id]["status"] = "failed"
        JOB_STATUS[job_id]["error"] = str(e)

@app.post("/api/render")
async def trigger_render(payload: RenderRequest, background_tasks: BackgroundTasks):
    job_id = uuid.uuid4().hex[:10]
    voice = payload.voice if payload.voice in ["male", "female"] else "male"
    
    JOB_STATUS[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "voice": voice,
        "video_file": None,
        "video_url": None,
        "error": None
    }

    background_tasks.add_task(run_render_task, job_id, voice, payload.scenes)

    return {
        "message": "Render job queued successfully",
        "job_id": job_id,
        "status_url": f"/api/status/{job_id}",
        "status": "queued"
    }

@app.get("/api/status/{job_id}")
def check_status(job_id: str):
    if job_id not in JOB_STATUS:
        raise HTTPException(status_code=404, detail="Job ID not found")
    return JOB_STATUS[job_id]

@app.get("/api/download/{filename}")
def download_video(filename: str):
    # Sanitize filename
    safe_filename = os.path.basename(filename)
    filepath = os.path.join(OUTPUT_DIR, safe_filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Rendered video not found")
    return FileResponse(
        filepath,
        media_type="video/mp4",
        filename=safe_filename,
        headers={"Content-Disposition": f"attachment; filename={safe_filename}"}
    )

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
