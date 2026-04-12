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

const cookieParser = require('cookie-parser');

const app = express();
// Upgrade Express to an HTTP server to support WebSockets
const server = http.createServer(app); 
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Setup Temporary Storage for 3D Models
const TEMP_DIR = path.join(__dirname, 'temp_models');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
app.use('/models', express.static(TEMP_DIR));

const PUBLIC_URL = process.env.WEBHOOK_PUBLIC_URL;
if (!PUBLIC_URL) console.warn('⚠️  WEBHOOK_PUBLIC_URL is not set — webhooks and model URLs will be broken!');

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
        res.cookie('authToken', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 });
        res.status(201).json({ message: 'Account created successfully', authenticated: true });
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
        res.cookie('authToken', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 });
        res.status(200).json({ message: 'Login successful', authenticated: true });
    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

app.get('/api/auth/verify', async (req, res) => {
    try {
        const token = req.cookies.authToken;
        if (!token) return res.status(401).json({ authenticated: false });

        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'xemy_secret');
        const user = await User.findById(decoded.userId);
        if (!user) return res.status(401).json({ authenticated: false });

        res.status(200).json({ authenticated: true, user: { id: user._id, name: user.name, email: user.email } });
    } catch (error) {
        res.status(401).json({ authenticated: false });
    }
});

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('authToken');
    res.status(200).json({ message: 'Logout successful' });
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
// ROUTE 1: Trigger the GPU and poll for completion
// ---------------------------------------------------------
app.post('/api/generate', async (req, res) => {
    const { prompt, sessionId } = req.body;
    if (!prompt || !sessionId) return res.status(400).json({ error: "Missing data" });

    // Sanitize sessionId up-front to prevent path traversal
    const safeSessionId = path.basename(sessionId);
    if (!safeSessionId || safeSessionId !== sessionId) {
        return res.status(400).json({ error: 'Invalid session ID' });
    }

    const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
    const ENDPOINT_ID = process.env.ENDPOINT_ID;

    try {
        const runRes = await fetch(`https://api.runpod.ai/v2/${ENDPOINT_ID}/run`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${RUNPOD_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ input: { prompt } })
        });

        const runData = await runRes.json();
        const jobId = runData.id;
        if (!jobId) return res.status(500).json({ error: 'Failed to queue job on RunPod' });

        res.status(200).json({ jobId, status: 'IN_QUEUE' });

        // Poll RunPod every 5 seconds until the job finishes
        const poll = setInterval(async () => {
            try {
                const statusRes = await fetch(`https://api.runpod.ai/v2/${ENDPOINT_ID}/status/${jobId}`, {
                    headers: { 'Authorization': `Bearer ${RUNPOD_API_KEY}` }
                });
                const statusData = await statusRes.json();
                const status = statusData.status;

                console.log(`   Polling ${jobId.slice(0, 8)} — ${status}`);

                // Emit live status so the frontend can show queue / in-progress feedback
                io.to(safeSessionId).emit('generation_status', { jobId, status });

                if (status === 'COMPLETED') {
                    clearInterval(poll);

                    const objB64 = statusData.output?.model_data;
                    if (!objB64) {
                        io.to(safeSessionId).emit('generation_failed', { error: 'Generation completed but model data was empty' });
                        return;
                    }

                    const userDir = path.join(TEMP_DIR, safeSessionId);
                    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir);

                    const fileName = `${jobId}.obj`;
                    const filePath = path.join(userDir, fileName);
                    fs.writeFileSync(filePath, Buffer.from(objB64, 'base64'));

                    const modelUrl = `${PUBLIC_URL}/models/${safeSessionId}/${fileName}`;
                    io.to(safeSessionId).emit('generation_complete', { modelUrl });

                } else if (['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(status)) {
                    clearInterval(poll);
                    io.to(safeSessionId).emit('generation_failed', { error: `Generation ${status.toLowerCase()}` });
                }
            } catch (pollError) {
                console.error(`Polling error for job ${jobId}:`, pollError);
            }
        }, 5000);

    } catch (error) {
        res.status(500).json({ error: "Failed to start GPU generation" });
    }
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Real-Time Xemy Backend on http://localhost:${PORT}`));