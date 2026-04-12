import runpod
import torch
import base64
import requests
from io import BytesIO
from PIL import Image

# Import TRELLIS specific libraries
from trellis.pipelines import TrellisImageTo3DPipeline
from trellis.utils import postprocessing_utils

# ---------------------------------------------------------
# Load models ONCE when the container starts up.
# ---------------------------------------------------------
print("Loading Microsoft TRELLIS into VRAM...")
# This automatically grabs the weights we cached in the Dockerfile
pipeline = TrellisImageTo3DPipeline.from_pretrained("JeffreyXiang/TRELLIS-image-large")
pipeline.cuda() # Move the model to the GPU
print("TRELLIS loaded and ready!")

def generate_3d(job):
    """
    This runs when Express hits the RunPod API.
    """
    job_input = job['input']
    
    # We now expect an image URL instead of a text prompt
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
        
        # 2. Run the TRELLIS AI generation
        # Seed 1 ensures consistent results. You can randomize this if you want variations.
        outputs = pipeline.run(image, seed=1)
        
        # 3. Post-process the output into a textured 3D Mesh
        # simplify=0.95 reduces the poly count slightly so it loads faster in the browser
        # texture_size=1024 gives us Meshy-level texture quality
        glb_mesh = postprocessing_utils.to_glb(
            outputs['gaussian'][0],
            outputs['mesh'][0],
            simplify=0.95,
            texture_size=1024 
        )
        
        # 4. Save to a temporary file
        temp_path = "/tmp/output.glb"
        glb_mesh.export(temp_path)
        
        # 5. Encode the GLB to base64 to send back to Express via Webhook
        with open(temp_path, "rb") as f:
            obj_base64 = base64.b64encode(f.read()).decode('utf-8')
        
        print("Generation complete! Sending to Webhook...")
        
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