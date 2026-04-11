import runpod
import torch
import base64
import io
from shap_e.diffusion.sample import sample_latents
from shap_e.diffusion.gaussian_diffusion import diffusion_from_config
from shap_e.models.download import load_model, load_config
from shap_e.util.notebooks import decode_latent_mesh

# Use GPU if available
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

# ---------------------------------------------------------
# Load models ONCE when the container starts up.
# This prevents 3-minute cold starts on every single API call!
# ---------------------------------------------------------
print("Loading Shap-E models into VRAM...")
xm = load_model('transmitter', device=device)
model = load_model('text300M', device=device)
diffusion = diffusion_from_config(load_config('diffusion'))
print("Models loaded successfully!")

def generate_3d(job):
    """
    This function runs every time you ping your RunPod endpoint.
    """
    job_input = job['input']
    prompt = job_input.get('prompt', 'a standard cube') # Default prompt if none provided
    
    # Magic numbers for Shap-E quality vs speed
    batch_size = 1
    guidance_scale = 15.0
    
    print(f"Generating 3D model for: {prompt}")
    
    try:
        # 1. Run the AI generation
        latents = sample_latents(
            batch_size=batch_size,
            model=model,
            diffusion=diffusion,
            guidance_scale=guidance_scale,
            model_kwargs=dict(texts=[prompt] * batch_size),
            progress=False,
            clip_denoised=True,
            use_fp16=True,
            use_karras=True,
            karras_steps=64, # Lower to 32 for faster, lower-quality tests
            sigma_min=1e-3,
            sigma_max=160,
            s_churn=0,
        )
        
        # 2. Decode the AI output into an actual 3D mesh
        mesh = decode_latent_mesh(xm, latents[0]).tri_mesh()
        
        # 3. Save to an in-memory buffer as an OBJ file
        buffer = io.StringIO()
        mesh.write_obj(buffer)
        
        # 4. Encode the OBJ to base64 so we can send it back via JSON
        obj_base64 = base64.b64encode(buffer.getvalue().encode('utf-8')).decode('utf-8')
        
        return {
            "status": "success", 
            "prompt": prompt,
            "model_data": obj_base64,
            "format": "obj"
        }
        
    except Exception as e:
        return {"status": "error", "message": str(e)}

# Start listening for requests
runpod.serverless.start({"handler": generate_3d})