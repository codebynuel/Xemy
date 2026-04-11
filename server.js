const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// Get these from your Runpod Dashboard
const RUNPOD_ENDPOINT_ID = 'your_endpoint_id_here'; 
const RUNPOD_API_KEY = 'your_api_key_here';

app.post('/api/generate', async (req, res) => {
    const { imageUrl } = req.body;
    
    try {
        console.log("Forwarding to Runpod...");
        
        // Using runSync so we don't have to build a queue/polling system yet.
        // Note: The request will hang here for ~10-30 seconds while the GPU works.
        const response = await axios.post(
            `https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/runSync`,
            { input: { image_url: imageUrl } },
            { 
                headers: { 
                    'Authorization': `Bearer ${RUNPOD_API_KEY}`,
                    'Content-Type': 'application/json'
                } 
            }
        );

        // Runpod returns the output of your Python handler
        const meshUrl = response.data.output.mesh_url; 
        res.json({ meshUrl });

    } catch (error) {
        console.error("Runpod Error:", error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to generate 3D model' });
    }
});

app.listen(3000, () => console.log('Barebones server running on http://localhost:3000'));