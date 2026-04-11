# Use RunPod's official PyTorch base image (it has CUDA pre-installed)
FROM runpod/pytorch:2.0.1-py3.10-cuda11.8.0-devel-ubuntu22.04

# Set our working directory inside the container
WORKDIR /app

# Install git so we can clone OpenAI's repo
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Clone the Shap-E repository
RUN git clone https://github.com/openai/shap-e.git

# Install Shap-E and its dependencies
RUN cd shap-e && pip install -e .

# Install our requirements (just RunPod SDK)
COPY requirements.txt .
RUN pip install -r requirements.txt

# --- THE SECRET SAUCE ---
# Download the model weights NOW so they are cached in the Docker image.
RUN python -c "import torch; from shap_e.models.download import load_model; load_model('transmitter', device='cpu'); load_model('text300M', device='cpu');"

# Copy our worker script in
COPY handler.py /app/handler.py

# Tell Docker what to run when the container starts
CMD ["python", "-u", "handler.py"]