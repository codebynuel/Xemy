import runpod
import torch
import base64
import requests
import rembg
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
        raw_image = Image.open(BytesIO(response.content))
        
        # 2. CRITICAL: Remove the background so TripoSR doesn't generate a cube!
        print("Removing background...")
        transparent_image = rembg.remove(raw_image)
        
        # 3. Composite onto a clean white background (TripoSR's preferred format)
        image = Image.new("RGB", transparent_image.size, (255, 255, 255))
        image.paste(transparent_image, mask=transparent_image.split()[3]) # Use alpha channel as mask
        
        print("Image pre-processed. Running 3D synthesis...")
        
        # 4. Run TripoSR inference
        with torch.no_grad():
            scene_codes = model([image], device="cuda")
        
        # 5. Extract the mesh and export as GLB
        meshes = model.extract_mesh(scene_codes, resolution=512, has_vertex_color=False)
        mesh = meshes[0]
        
        # 6. Save to a temporary GLB file
        temp_path = "/tmp/output.glb"
        mesh.export(temp_path)
        
        # 7. Encode the GLB to base64 to send back to Express
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