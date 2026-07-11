import os
import shutil
import subprocess
import nest_asyncio
from fastapi import FastAPI, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import FileResponse
from typing import List
import uvicorn
from pyngrok import ngrok
import json

# Setup environment
WORKSPACE = "/tmp/inview3d_workspace"
os.makedirs(WORKSPACE, exist_ok=True)

app = FastAPI()

def run_command(cmd, cwd=WORKSPACE):
    print(f"Running: {cmd}")
    process = subprocess.Popen(cmd, shell=True, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    for line in process.stdout:
        print(line.decode('utf-8').strip())
    process.wait()
    if process.returncode != 0:
        raise Exception(f"Command failed with code {process.returncode}: {cmd}")

def process_job(job_id: str):
    job_dir = os.path.join(WORKSPACE, job_id)
    images_dir = os.path.join(job_dir, "images")
    processed_dir = os.path.join(job_dir, "processed")
    output_dir = os.path.join(job_dir, "output")
    
    try:
        # Step 1: COLMAP SfM (Data ingestion)
        # Using ns-process-data images
        print(f"[{job_id}] Starting ns-process-data...")
        run_command(f"ns-process-data images --data {images_dir} --output-dir {processed_dir}", cwd=job_dir)
        
        # Step 2: Gaussian Splatting Training
        # Using splatfacto
        print(f"[{job_id}] Starting splatfacto training...")
        # Limiting iterations to 2000 for fast Colab execution
        run_command(f"ns-train splatfacto --data {processed_dir} --max-num-iterations 2000 --output-dir {output_dir}", cwd=job_dir)
        
        # Step 3: Export to .ply
        print(f"[{job_id}] Exporting .ply file...")
        config_path = os.path.join(output_dir, "splatfacto", "latest", "config.yml") # exact path depends on run name
        # Find config path dynamically
        for root, dirs, files in os.walk(output_dir):
            if "config.yml" in files:
                config_path = os.path.join(root, "config.yml")
                break
                
        export_dir = os.path.join(job_dir, "export")
        os.makedirs(export_dir, exist_ok=True)
        run_command(f"ns-export gaussian-splat --load-config {config_path} --output-dir {export_dir}", cwd=job_dir)
        
        # Mark as completed
        with open(os.path.join(job_dir, "status.txt"), "w") as f:
            f.write("completed")
            
    except Exception as e:
        print(f"[{job_id}] ERROR: {e}")
        with open(os.path.join(job_dir, "status.txt"), "w") as f:
            f.write(f"failed: {str(e)}")

@app.post("/process")
async def start_process(
    background_tasks: BackgroundTasks,
    photos: List[UploadFile] = File(...),
    poses: str = Form(...)
):
    import uuid
    job_id = str(uuid.uuid4())
    
    job_dir = os.path.join(WORKSPACE, job_id)
    images_dir = os.path.join(job_dir, "images")
    os.makedirs(images_dir, exist_ok=True)
    
    # Save photos
    for idx, photo in enumerate(photos):
        content = await photo.read()
        with open(os.path.join(images_dir, f"frame_{idx:03d}.jpg"), "wb") as f:
            f.write(content)
            
    # Save poses JSON
    with open(os.path.join(job_dir, "poses.json"), "w") as f:
        f.write(poses)
        
    with open(os.path.join(job_dir, "status.txt"), "w") as f:
        f.write("processing")

    background_tasks.add_task(process_job, job_id)
    
    return {"job_id": job_id, "status": "processing"}

@app.get("/status/{job_id}")
async def get_status(job_id: str):
    status_file = os.path.join(WORKSPACE, job_id, "status.txt")
    if not os.path.exists(status_file):
        return {"status": "not_found"}
        
    with open(status_file, "r") as f:
        status = f.read().strip()
        
    return {"job_id": job_id, "status": status}

@app.get("/download/{job_id}")
async def download_model(job_id: str):
    export_dir = os.path.join(WORKSPACE, job_id, "export")
    # splatfacto exports 'splat.ply' by default
    ply_path = os.path.join(export_dir, "splat.ply") 
    
    if os.path.exists(ply_path):
        return FileResponse(ply_path, media_type='application/octet-stream', filename="model.ply")
    return {"error": "Model not found or not finished processing"}

if __name__ == "__main__":
    # Start ngrok
    print("Starting ngrok tunnel...")
    public_url = ngrok.connect(8000)
    print(f"==================================================")
    print(f"YOUR CLOUD GPU PIPELINE URL:")
    print(f"{public_url}")
    print(f"==================================================")
    
    nest_asyncio.apply()
    uvicorn.run(app, host="0.0.0.0", port=8000)
