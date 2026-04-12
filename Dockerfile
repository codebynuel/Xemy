# Use a slightly newer RunPod PyTorch base image for better compatibility
FROM runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04

# Set our working directory inside the container
WORKDIR /app

# Install system dependencies for 3D math and image processing
RUN apt-get update && apt-get install -y git ninja-build libgl1-mesa-glx libglib2.0-0 wget && rm -rf /var/lib/apt/lists/*

# Clone Microsoft's TRELLIS repository
RUN git clone https://github.com/Microsoft/TRELLIS.git /app/TRELLIS

# Move into the TRELLIS directory for the rest of the setup
WORKDIR /app/TRELLIS

# Upgrade pip
RUN pip install --upgrade pip

# --- THE FIX: Manually install TRELLIS dependencies ---
RUN pip install pillow imageio imageio-ffmpeg tqdm easydict opencv-python-headless scipy rembg onnxruntime trimesh xatlas pyvista pymeshfix igraph transformers accelerate
RUN pip install git+https://github.com/EasternJournalist/utils3d.git@9a4eb15e4021b67b12c460c7057d642626897ec8

# Install the heavy GPU math libraries (Using a pre-compiled wheel for flash-attn to skip the 20-min build!)
RUN pip install spconv-cu118 xformers
RUN pip install https://github.com/Dao-AILab/flash-attention/releases/download/v2.4.2/flash_attn-2.4.2+cu118torch2.1cxx11abiFALSE-cp310-cp310-linux_x86_64.whl

# Install RunPod SDK and HuggingFace Hub
RUN pip install runpod huggingface_hub requests

# --- THE SECRET SAUCE ---
# Download the massive TRELLIS weights from Hugging Face during the Docker build.
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='JeffreyXiang/TRELLIS-image-large')"

# Copy our worker script into the TRELLIS folder (Assuming handler.py is in your repo's root)
COPY handler.py /app/TRELLIS/handler.py

# Start the RunPod listener
CMD ["python", "-u", "handler.py"]