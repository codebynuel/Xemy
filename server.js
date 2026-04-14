require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const cookieParser = require('cookie-parser');

// Connect to MongoDB
require('./functions/db');

const {
    CREDITS_FREE, PLAN_CREDITS,
    COST_TEXT_TO_3D, COST_IMAGE_TO_3D, COST_MULTI_IMAGE_TO_3D, COST_TEXTURE
} = require('./functions/config');
const authenticateRequest = require('./functions/middleware/auth');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Make io accessible to routers via req.app.get('io')
app.set('io', io);

// Middleware
app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Static asset directories
const TEMP_DIR = path.join(__dirname, 'temp_models');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
app.use('/models', express.static(TEMP_DIR));

const THUMB_DIR = path.join(TEMP_DIR, '_thumbnails');
if (!fs.existsSync(THUMB_DIR)) fs.mkdirSync(THUMB_DIR, { recursive: true });
app.use('/thumbnails', express.static(THUMB_DIR));

const UPLOAD_DIR = path.join(TEMP_DIR, '_uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

// ---------------------------------------------------------
// Routes
// ---------------------------------------------------------
app.use('/api/auth', require('./functions/routes/auth'));
app.use('/api/3d-model-generator', require('./functions/routes/3d-model-generator'));

// Shared credit balance endpoint
app.get('/api/credits', async (req, res) => {
    const user = await authenticateRequest(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    // Lazy monthly credit reset
    if (user.creditsResetAt && user.creditsResetAt <= new Date()) {
        const allowance = PLAN_CREDITS[user.plan] ?? CREDITS_FREE;
        user.credits = allowance;
        user.creditsResetAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await user.save();
    }

    res.json({
        credits: user.credits,
        plan: user.plan,
        creditsResetAt: user.creditsResetAt,
        costs: { text: COST_TEXT_TO_3D, image: COST_IMAGE_TO_3D, multiImage: COST_MULTI_IMAGE_TO_3D, texture: COST_TEXTURE }
    });
});

// ---------------------------------------------------------
// WebSocket connections
// ---------------------------------------------------------
io.on('connection', (socket) => {
    console.log(`🔌 New client connected: ${socket.id}`);

    socket.on('register_session', (sessionId) => {
        socket.join(sessionId);
        console.log(`User joined session room: ${sessionId}`);
    });

    socket.on('disconnect', () => console.log(`Client disconnected`));
});

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Real-Time Xemy Backend on http://localhost:${PORT}`));