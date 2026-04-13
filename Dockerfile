# Use the same RunPod PyTorch base image
FROM runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y git libgl1-mesa-glx libglib2.0-0 && rm -rf /var/lib/apt/lists/*

# Clone TripoSR repository
RUN git clone https://github.com/VAST-AI-Research/TripoSR.git /app/TripoSR

WORKDIR /app/TripoSR

# Upgrade pip
RUN pip install --upgrade pip

# Install TripoSR dependencies (much lighter than TRELLIS)
RUN pip install pillow transformers trimesh rembg onnxruntime numpy einops omegaconf pytorch-lightning huggingface_hub PyMCubes

# Install RunPod SDK
RUN pip install runpod requests

# Download TripoSR model weights (~600MB vs TRELLIS multi-GB)
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='stabilityai/TripoSR', repo_type='model')"

# Copy our worker script
COPY handler.py /app/TripoSR/handler.py

# Start the RunPod listener
CMD ["python", "-u", "handler.py"]