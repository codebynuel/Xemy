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

// Thumbnail storage
const THUMB_DIR = path.join(__dirname, 'temp_models', '_thumbnails');
if (!fs.existsSync(THUMB_DIR)) fs.mkdirSync(THUMB_DIR, { recursive: true });
app.use('/thumbnails', express.static(THUMB_DIR));

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

const generationSchema = new mongoose.Schema({
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sessionId: { type: String, required: true },
    prompt:    { type: String, required: true },
    name:      { type: String, default: '' },
    modelPath: { type: String },
    modelUrl:  { type: String },
    thumbnail: { type: String, default: '' },
    status:    { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
    createdAt: { type: Date, default: Date.now }
});
generationSchema.index({ userId: 1, createdAt: -1 });
const Generation = mongoose.model('Generation', generationSchema);

// Auth middleware helper
async function authenticateRequest(req) {
    try {
        const token = req.cookies.authToken;
        if (!token) return null;
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'xemy_secret');
        return await User.findById(decoded.userId);
    } catch {
        return null;
    }
}

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
// SERVER-SIDE THUMBNAIL GENERATION
// ---------------------------------------------------------
function generateThumbnail(objText, generationId) {
    try {
        // Parse OBJ vertices and project to 2D isometric view
        const vertices = [];
        const lines = objText.split('\n');
        for (const line of lines) {
            if (line.startsWith('v ')) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 4) {
                    vertices.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
                }
            }
        }

        if (vertices.length === 0) return '';

        // Compute bounding box
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (const [x, y, z] of vertices) {
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }

        // Center and normalize
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
        const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;

        // Isometric projection (30-degree rotation)
        const cos30 = Math.cos(Math.PI / 6);
        const sin30 = 0.5;
        const size = 200;
        const padding = 20;
        const scale = (size - padding * 2) / 2;

        // Project vertices to 2D
        const projected = vertices.map(([x, y, z]) => {
            const nx = (x - cx) / span;
            const ny = (y - cy) / span;
            const nz = (z - cz) / span;
            const px = (nx - nz) * cos30;
            const py = -ny + (nx + nz) * sin30;
            return [size / 2 + px * scale, size / 2 + py * scale];
        });

        // Sample a subset of points for the SVG (max 2000 for performance)
        const step = Math.max(1, Math.floor(projected.length / 2000));
        let dots = '';
        for (let i = 0; i < projected.length; i += step) {
            const [px, py] = projected[i];
            dots += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="0.8" fill="#b8f147" opacity="0.7"/>`;
        }

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<rect width="${size}" height="${size}" fill="#19191c" rx="12"/>
${dots}
</svg>`;

        const thumbFileName = `${generationId}.svg`;
        const thumbPath = path.join(THUMB_DIR, thumbFileName);
        fs.writeFileSync(thumbPath, svg);
        return `/thumbnails/${thumbFileName}`;
    } catch (err) {
        console.error('Thumbnail generation failed:', err);
        return '';
    }
}

// ---------------------------------------------------------
// ROUTE 1: Trigger the GPU and poll for completion
// ---------------------------------------------------------
app.post('/api/generate', async (req, res) => {
    const { prompt, sessionId, name, guidanceScale, steps } = req.body;
    if (!prompt || !sessionId) return res.status(400).json({ error: "Missing data" });

    const user = await authenticateRequest(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    // Sanitize sessionId up-front to prevent path traversal
    const safeSessionId = path.basename(sessionId);
    if (!safeSessionId || safeSessionId !== sessionId) {
        return res.status(400).json({ error: 'Invalid session ID' });
    }

    const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY;
    const ENDPOINT_ID = process.env.ENDPOINT_ID;

    // Create a pending generation record
    let generation;
    try {
        generation = await Generation.create({
            userId: user._id,
            sessionId: safeSessionId,
            prompt,
            name: name || '',
            status: 'pending'
        });
    } catch (dbErr) {
        console.error('Failed to create generation record:', dbErr);
        return res.status(500).json({ error: 'Database error' });
    }

    try {
        const runRes = await fetch(`https://api.runpod.ai/v2/${ENDPOINT_ID}/run`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${RUNPOD_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ input: { prompt, guidance_scale: guidanceScale, num_steps: steps } })
        });

        const runData = await runRes.json();
        const jobId = runData.id;
        if (!jobId) {
            await Generation.findByIdAndUpdate(generation._id, { status: 'failed' });
            return res.status(500).json({ error: 'Failed to queue job on RunPod' });
        }

        res.status(200).json({ jobId, status: 'IN_QUEUE', generationId: generation._id });

        // Poll RunPod every 5 seconds until the job finishes
        let pollDone = false;
        const poll = setInterval(async () => {
            if (pollDone) return;
            try {
                const statusRes = await fetch(`https://api.runpod.ai/v2/${ENDPOINT_ID}/status/${jobId}`, {
                    headers: { 'Authorization': `Bearer ${RUNPOD_API_KEY}` }
                });
                const statusData = await statusRes.json();
                const status = statusData.status;

                console.log(`   Polling ${jobId.slice(0, 8)} — ${status}`);

                io.to(safeSessionId).emit('generation_status', { jobId, status });

                if (status === 'COMPLETED') {
                    pollDone = true;
                    clearInterval(poll);

                    const objB64 = statusData.output?.model_data;
                    if (!objB64) {
                        await Generation.findByIdAndUpdate(generation._id, { status: 'failed' });
                        io.to(safeSessionId).emit('generation_failed', { error: 'Generation completed but model data was empty' });
                        return;
                    }

                    const userDir = path.join(TEMP_DIR, safeSessionId);
                    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir);

                    const fileName = `${jobId}.obj`;
                    const filePath = path.join(userDir, fileName);
                    const objBuffer = Buffer.from(objB64, 'base64');
                    fs.writeFileSync(filePath, objBuffer);

                    const modelUrl = `${PUBLIC_URL}/models/${safeSessionId}/${fileName}`;

                    // Generate thumbnail server-side
                    const thumbnailUrl = generateThumbnail(objBuffer.toString('utf8'), generation._id.toString());

                    await Generation.findByIdAndUpdate(generation._id, {
                        status: 'completed',
                        modelPath: filePath,
                        modelUrl,
                        thumbnail: thumbnailUrl
                    });

                    io.to(safeSessionId).emit('generation_complete', {
                        modelUrl,
                        generationId: generation._id,
                        prompt,
                        name: name || '',
                        thumbnail: thumbnailUrl
                    });

                } else if (['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(status)) {
                    pollDone = true;
                    clearInterval(poll);
                    await Generation.findByIdAndUpdate(generation._id, { status: 'failed' });
                    io.to(safeSessionId).emit('generation_failed', { error: `Generation ${status.toLowerCase()}` });
                }
            } catch (pollError) {
                console.error(`Polling error for job ${jobId}:`, pollError);
            }
        }, 5000);

    } catch (error) {
        await Generation.findByIdAndUpdate(generation._id, { status: 'failed' });
        res.status(500).json({ error: "Failed to start GPU generation" });
    }
});

// ---------------------------------------------------------
// GENERATION CRUD
// ---------------------------------------------------------
app.get('/api/generations', async (req, res) => {
    const user = await authenticateRequest(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    try {
        const generations = await Generation.find({ userId: user._id, status: 'completed' })
            .sort({ createdAt: -1 })
            .limit(50)
            .select('prompt name modelUrl thumbnail createdAt');
        res.json(generations);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch generations' });
    }
});

app.put('/api/generations/:id', async (req, res) => {
    const user = await authenticateRequest(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    try {
        const gen = await Generation.findOne({ _id: req.params.id, userId: user._id });
        if (!gen) return res.status(404).json({ error: 'Generation not found' });

        if (req.body.name !== undefined) gen.name = req.body.name;
        await gen.save();
        res.json(gen);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update generation' });
    }
});

app.delete('/api/generations/:id', async (req, res) => {
    const user = await authenticateRequest(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    try {
        const gen = await Generation.findOne({ _id: req.params.id, userId: user._id });
        if (!gen) return res.status(404).json({ error: 'Generation not found' });

        // Remove OBJ file from disk
        if (gen.modelPath && fs.existsSync(gen.modelPath)) {
            fs.unlinkSync(gen.modelPath);
        }
        // Remove thumbnail
        const thumbPath = path.join(THUMB_DIR, `${gen._id}.svg`);
        if (fs.existsSync(thumbPath)) {
            fs.unlinkSync(thumbPath);
        }

        await Generation.deleteOne({ _id: gen._id });
        res.json({ message: 'Generation deleted' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete generation' });
    }
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Real-Time Xemy Backend on http://localhost:${PORT}`));