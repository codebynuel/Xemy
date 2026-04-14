# Use the same RunPod PyTorch base image
FROM runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y git libgl1-mesa-glx libglib2.0-0 && rm -rf /var/lib/apt/lists/*

# Clone TripoSR repository
RUN git clone https://github.com/VAST-AI-Research/TripoSR.git /app/TripoSR

WORKDIR /app/TripoSR

# Upgrade pip and setuptools (needed for torchmcubes build)
RUN pip install --upgrade pip "setuptools>=49.6.0"

# Install TripoSR deps with PINNED versions from its requirements.txt
RUN pip install \
    "omegaconf==2.3.0" \
    "Pillow==10.1.0" \
    "einops==0.7.0" \
    "transformers==4.35.0" \
    "trimesh==4.0.5" \
    "accelerate==0.29.3" \
    "rembg" \
    "huggingface_hub" \
    "pytorch-lightning" \
    "onnxruntime"

# Install torchmcubes from source (TripoSR's marching cubes dependency)
RUN pip install git+https://github.com/tatsy/torchmcubes.git

# Force numpy<2 AFTER all other deps so transitive installs can't override it
RUN pip install "numpy<2" --force-reinstall

# Install RunPod SDK
RUN pip install runpod requests

# Download TripoSR model weights (~600MB vs TRELLIS multi-GB)
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='stabilityai/TripoSR', repo_type='model')"

# Copy our worker script
COPY handler.py /app/TripoSR/handler.py

# Start the RunPod listener
CMD ["python", "-u", "handler.py"]