import runpod
import torch
import base64
import requests
from io import BytesIO
from PIL import Image

# Import TripoSR
import sys
sys.path.insert(0, "/app/TripoSR")
from tsr.system import TSR

# ---------------------------------------------------------
# Load models ONCE when the container starts up.
# ---------------------------------------------------------
print("Loading TripoSR into VRAM...")
model = TSR.from_pretrained(
    "stabilityai/TripoSR",
    config_name="config.yaml",
    weight_name="model.ckpt",
)
model.to("cuda")
print("TripoSR loaded and ready!")

def generate_3d(job):
    """
    This runs when Express hits the RunPod API.
    """
    job_input = job['input']
    
    # We expect an image URL
    image_url = job_input.get('image_url')
    
    if not image_url:
        return {"status": "error", "message": "No image_url provided."}
    
    print(f"Downloading reference image from: {image_url}")
    
    try:
        # 1. Fetch the 2D image from the URL
        response = requests.get(image_url)
        response.raise_for_status()
        image = Image.open(BytesIO(response.content)).convert("RGB")
        
        print("Image downloaded. Running 3D synthesis...")
        
        # 2. Run TripoSR inference
        with torch.no_grad():
            scene_codes = model([image], device="cuda")
        
        # 3. Extract the mesh and export as GLB
        meshes = model.extract_mesh(scene_codes, resolution=256)
        mesh = meshes[0]
        
        # 4. Save to a temporary GLB file
        temp_path = "/tmp/output.glb"
        mesh.export(temp_path)
        
        # 5. Encode the GLB to base64 to send back to Express
        with open(temp_path, "rb") as f:
            obj_base64 = base64.b64encode(f.read()).decode('utf-8')
        
        print("Generation complete! Sending result...")
        
        return {
            "status": "success", 
            "model_data": obj_base64,
            "format": "glb"
        }
        
    except Exception as e:
        print(f"Error during generation: {str(e)}")
        return {"status": "error", "message": str(e)}

# Start listening for requests
runpod.serverless.start({"handler": generate_3d})