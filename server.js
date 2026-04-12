require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
// Upgrade Express to an HTTP server to support WebSockets
const server = http.createServer(app); 
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Setup Temporary Storage for 3D Models
const TEMP_DIR = path.join(__dirname, 'temp_models');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
app.use('/models', express.static(TEMP_DIR));

// ---------------------------------------------------------
// DATABASE & AUTHENTICATION
// ---------------------------------------------------------
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/xemy')
    .then(() => console.log('📦 Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

const userSchema = new mongoose.Schema({
    name: { type: String },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

app.post('/api/auth/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ error: 'User already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ name, email, password: hashedPassword });
        await newUser.save();

        const token = jwt.sign({ userId: newUser._id }, process.env.JWT_SECRET || 'xemy_secret', { expiresIn: '7d' });
        res.status(201).json({ token, message: 'Account created successfully' });
    } catch (error) {
        console.error('Registration Error:', error);
        res.status(500).json({ error: 'Failed to create account' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ error: 'Invalid email or password' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: 'Invalid email or password' });

        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'xemy_secret', { expiresIn: '7d' });
        res.status(200).json({ token, message: 'Login successful' });
    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// ---------------------------------------------------------
// WEBSOCKETS: Handle real-time user connections
// ---------------------------------------------------------
io.on('connection', (socket) => {
    console.log(`🔌 New client connected: ${socket.id}`);
    
    // When the frontend loads, it tells us its sessionId.
    // We put this socket connection into a "room" with that ID.
    socket.on('register_session', (sessionId) => {
        socket.join(sessionId);
        console.log(`User joined session room: ${sessionId}`);
    });

    socket.on('disconnect', () => console.log(`Client disconnected`));
});

// ---------------------------------------------------------
// ROUTE 1: Trigger the GPU (and pass the Webhook URL)
// ---------------------------------------------------------
app.post('/api/generate', async (req, res) => {
    const { prompt, sessionId } = req.body;
    if (!prompt || !sessionId) return res.status(400).json({ error: "Missing data" });

    const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
    const ENDPOINT_ID = process.env.ENDPOINT_ID;
    
    // This is the magic! We tell RunPod to hit this exact URL when it finishes.
    // We include the sessionId in the URL so we know WHO to send the model to later.
    const PUBLIC_URL = process.env.WEBHOOK_PUBLIC_URL;
    const webhookUrl = `${PUBLIC_URL}/api/webhook/${sessionId}`;

    try {
        const runRes = await fetch(`https://api.runpod.ai/v2/${ENDPOINT_ID}/run`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${RUNPOD_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                input: { prompt },
                webhook: webhookUrl // Tell RunPod where to send the result!
            })
        });
        
        const runData = await runRes.json();
        res.status(200).json({ jobId: runData.id, status: "IN_QUEUE" });

    } catch (error) {
        res.status(500).json({ error: "Failed to start GPU generation" });
    }
});

// ---------------------------------------------------------
// ROUTE 2: THE WEBHOOK (RunPod POSTs to this when done!)
// ---------------------------------------------------------
app.post('/api/webhook/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const runpodData = req.body;

    console.log(`🔔 Webhook received for session: ${sessionId}. Status: ${runpodData.status}`);

    if (runpodData.status === 'COMPLETED') {
        const userDir = path.join(TEMP_DIR, sessionId);
        if (!fs.existsSync(userDir)) fs.mkdirSync(userDir);

        const fileName = `${runpodData.id}.obj`;
        const filePath = path.join(userDir, fileName);

        // Save the base64 data to a file
        const objB64 = runpodData.output.model_data;
        const objBuffer = Buffer.from(objB64, 'base64');
        fs.writeFileSync(filePath, objBuffer);

        const modelUrl = `http://localhost:3000/models/${sessionId}/${fileName}`;
        
        // BOOM! Push the URL to the exact user over WebSockets
        io.to(sessionId).emit('generation_complete', { modelUrl });
    } 
    else if (runpodData.status === 'FAILED') {
        io.to(sessionId).emit('generation_failed', { error: "GPU Generation Failed" });
    }

    // You MUST return 200 OK so RunPod knows you received the webhook
    res.status(200).send('Webhook Received');
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Real-Time Xemy Backend on http://localhost:${PORT}`));