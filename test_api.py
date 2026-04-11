import requests
import base64
import time

# You get these from your RunPod Dashboard
RUNPOD_API_KEY = "YOUR_API_KEY_HERE"
ENDPOINT_ID = "YOUR_ENDPOINT_ID_HERE"

# Notice we use 'runsync' for testing, which waits for the result
url = f"https://api.runpod.ai/v2/{ENDPOINT_ID}/runsync"

headers = {
    "Authorization": f"Bearer {RUNPOD_API_KEY}",
    "Content-Type": "application/json"
}

payload = {
    "input": {
        "prompt": "a low poly green tree"
    }
}

print(f"Pinging RunPod... Generating '{payload['input']['prompt']}'")
start_time = time.time()

response = requests.post(url, headers=headers, json=payload)
data = response.json()

if data.get('status') == 'COMPLETED':
    print(f"Done! Took {round(time.time() - start_time, 2)} seconds.")
    
    # Extract the base64 string
    obj_b64 = data['output']['model_data']
    obj_content = base64.b64decode(obj_b64).decode('utf-8')
    
    # Save it locally so you can open it in Blender or Windows 3D Viewer!
    file_name = "test_output.obj"
    with open(file_name, "w") as f:
        f.write(obj_content)
    print(f"Successfully saved 3D model as {file_name}")
else:
    print("Something went wrong:", data)