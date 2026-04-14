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
const multer = require('multer');

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

// Upload storage for reference images
const UPLOAD_DIR = path.join(__dirname, 'temp_models', '_uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOAD_DIR));

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOAD_DIR),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase();
            const allowed = ['.png', '.jpg', '.jpeg', '.webp'];
            if (!allowed.includes(ext)) return cb(new Error('Invalid file type'));
            cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
        }
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only images are allowed'));
    }
});

const PUBLIC_URL = process.env.PUBLIC_URL;
if (!PUBLIC_URL) console.warn('⚠️  WEBHOOK_PUBLIC_URL is not set — webhooks and model URLs will be broken!');

// ---------------------------------------------------------
// DATABASE & AUTHENTICATION
// ---------------------------------------------------------
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/xemy')
    .then(() => console.log('📦 Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// Credit economy — all tuneable via .env
const CREDITS_FREE    = parseInt(process.env.CREDITS_FREE)    || 150;
const CREDITS_STARTER = parseInt(process.env.CREDITS_STARTER) || 1500;
const CREDITS_PRO     = parseInt(process.env.CREDITS_PRO)     || 5000;
const COST_TEXT_TO_3D       = parseInt(process.env.COST_TEXT_TO_3D)       || 50;
const COST_IMAGE_TO_3D      = parseInt(process.env.COST_IMAGE_TO_3D)     || 50;
const COST_MULTI_IMAGE_TO_3D = parseInt(process.env.COST_MULTI_IMAGE_TO_3D) || 75;

const PLAN_CREDITS = { free: CREDITS_FREE, starter: CREDITS_STARTER, pro: CREDITS_PRO, enterprise: Infinity };

const userSchema = new mongoose.Schema({
    name:             { type: String },
    email:            { type: String, required: true, unique: true },
    password:         { type: String, required: true },
    credits:          { type: Number, default: CREDITS_FREE },
    plan:             { type: String, enum: ['free', 'starter', 'pro', 'enterprise'], default: 'free' },
    creditsResetAt:   { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    totalCreditsUsed: { type: Number, default: 0 }
});
const User = mongoose.model('User', userSchema);

const generationSchema = new mongoose.Schema({
    userId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    sessionId:      { type: String, required: true },
    mode:           { type: String, enum: ['text', 'image'], default: 'text' },
    prompt:         { type: String, default: '' },
    name:           { type: String, default: '' },
    referenceImage: { type: String, default: '' },
    modelPath:      { type: String },
    modelUrl:       { type: String },
    thumbnail:      { type: String, default: '' },
    status:         { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
    creditCost:     { type: Number, default: 0 },
    createdAt:      { type: Date, default: Date.now }
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
        const newUser = new User({
            name,
            email,
            password: hashedPassword,
            credits: CREDITS_FREE,
            plan: 'free',
            creditsResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        });
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

        // Lazy monthly credit reset
        if (user.creditsResetAt && user.creditsResetAt <= new Date()) {
            const allowance = PLAN_CREDITS[user.plan] ?? CREDITS_FREE;
            user.credits = allowance;
            user.creditsResetAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            await user.save();
        }

        res.status(200).json({
            authenticated: true,
            user: { id: user._id, name: user.name, email: user.email },
            credits: user.credits,
            plan: user.plan,
            creditsResetAt: user.creditsResetAt,
            costs: { text: COST_TEXT_TO_3D, image: COST_IMAGE_TO_3D, multiImage: COST_MULTI_IMAGE_TO_3D }
        });
    } catch (error) {
        res.status(401).json({ authenticated: false });
    }
});

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('authToken');
    res.status(200).json({ message: 'Logout successful' });
});

// Credit balance endpoint
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
        costs: { text: COST_TEXT_TO_3D, image: COST_IMAGE_TO_3D, multiImage: COST_MULTI_IMAGE_TO_3D }
    });
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
// Generate image from text using fal.ai FLUX
// ---------------------------------------------------------
async function generateImageFromText(prompt) {
    const FAL_KEY = process.env.FAL_KEY;
    if (!FAL_KEY) throw new Error('FAL_KEY not configured');

    // Submit to fal.ai queue
    const submitRes = await fetch('https://queue.fal.run/fal-ai/flux/dev', {
        method: 'POST',
        headers: {
            'Authorization': `Key ${FAL_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            prompt,
            image_size: 'square_hd',
            num_images: 1
        })
    });
    const submitData = await submitRes.json();

    // If already complete (sync response)
    if (submitData.images?.[0]?.url) {
        return submitData.images[0].url;
    }

    // Otherwise poll status_url
    const statusUrl = submitData.status_url;
    const responseUrl = submitData.response_url;
    if (!statusUrl || !responseUrl) throw new Error('fal.ai did not return queue URLs');

    // Poll until ready
    for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const pollRes = await fetch(statusUrl, {
            headers: { 'Authorization': `Key ${FAL_KEY}` }
        });
        const pollData = await pollRes.json();
        if (pollData.status === 'COMPLETED') break;
        if (pollData.status === 'FAILED') throw new Error('FLUX image generation failed');
    }

    // Get result
    const resultRes = await fetch(responseUrl, {
        headers: { 'Authorization': `Key ${FAL_KEY}` }
    });
    const resultData = await resultRes.json();
    const imageUrl = resultData.images?.[0]?.url;
    if (!imageUrl) throw new Error('FLUX returned no image');
    return imageUrl;
}

// Save a remote image locally for use as thumbnail
async function downloadImageAsThumb(imageUrl, generationId) {
    try {
        const res = await fetch(imageUrl);
        if (!res.ok) return '';
        const buffer = Buffer.from(await res.arrayBuffer());
        const ext = imageUrl.includes('.png') ? '.png' : '.jpg';
        const thumbFileName = `${generationId}${ext}`;
        const thumbPath = path.join(THUMB_DIR, thumbFileName);
        fs.writeFileSync(thumbPath, buffer);
        return `/thumbnails/${thumbFileName}`;
    } catch (err) {
        console.error('Thumbnail download failed:', err);
        return '';
    }
}

// ---------------------------------------------------------
// ROUTE: Upload reference image
// ---------------------------------------------------------
app.post('/api/upload-image', async (req, res) => {
    const user = await authenticateRequest(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    upload.single('image')(req, res, (err) => {
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const imageUrl = `${PUBLIC_URL}/uploads/${req.file.filename}`;
        res.json({ imageUrl });
    });
});

// ---------------------------------------------------------
// ROUTE: Trigger the GPU and poll for completion
// ---------------------------------------------------------
app.post('/api/generate', async (req, res) => {
    const { mode, prompt, imageUrl, imageUrls, sessionId, name } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });
    if (mode === 'text' && !prompt) return res.status(400).json({ error: 'Missing prompt' });
    if (mode === 'image' && !imageUrl && (!imageUrls || !imageUrls.length)) return res.status(400).json({ error: 'Missing image(s)' });

    const user = await authenticateRequest(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    // Sanitize sessionId to prevent path traversal
    const safeSessionId = path.basename(sessionId);
    if (!safeSessionId || safeSessionId !== sessionId) {
        return res.status(400).json({ error: 'Invalid session ID' });
    }

    const FAL_KEY = process.env.FAL_KEY;

    // Calculate credit cost for this generation
    const isMultiImage = Array.isArray(imageUrls) && imageUrls.length > 1;
    const creditCost = isMultiImage ? COST_MULTI_IMAGE_TO_3D
                     : mode === 'text' ? COST_TEXT_TO_3D
                     : COST_IMAGE_TO_3D;

    // Atomic credit deduction — prevents race conditions
    const deducted = await User.findOneAndUpdate(
        { _id: user._id, credits: { $gte: creditCost } },
        { $inc: { credits: -creditCost, totalCreditsUsed: creditCost } },
        { new: true }
    );
    if (!deducted) {
        return res.status(403).json({
            error: 'Insufficient credits',
            credits: user.credits,
            required: creditCost
        });
    }

    // Create a pending generation record
    let generation;
    try {
        generation = await Generation.create({
            userId: user._id,
            sessionId: safeSessionId,
            mode: mode || 'text',
            prompt: prompt || '',
            name: name || '',
            referenceImage: imageUrl || '',
            status: 'pending',
            creditCost
        });
    } catch (dbErr) {
        console.error('Failed to create generation record:', dbErr);
        return res.status(500).json({ error: 'Database error' });
    }

    try {
        let referenceImageUrl = imageUrl;

        // Text mode: generate reference image via fal.ai FLUX first
        if (mode === 'text') {
            io.to(safeSessionId).emit('generation_status', { status: 'GENERATING_IMAGE' });
            console.log(`   FLUX: generating reference image for "${prompt.slice(0, 50)}"`);
            referenceImageUrl = await generateImageFromText(prompt);

            // Save FLUX image as thumbnail and update record
            const thumbnailUrl = await downloadImageAsThumb(referenceImageUrl, generation._id.toString());
            await Generation.findByIdAndUpdate(generation._id, { referenceImage: referenceImageUrl, thumbnail: thumbnailUrl });
        }

        // Submit to fal.ai TRELLIS (single or multi-image)
        io.to(safeSessionId).emit('generation_status', { status: 'IN_QUEUE' });

        const trellisEndpoint = isMultiImage
            ? 'https://queue.fal.run/fal-ai/trellis/multi-image'
            : 'https://queue.fal.run/fal-ai/trellis';
        const trellisInput = isMultiImage
            ? { image_urls: imageUrls }
            : { image_url: referenceImageUrl || (imageUrls && imageUrls[0]) };

        const submitRes = await fetch(trellisEndpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Key ${FAL_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(trellisInput)
        });

        const submitData = await submitRes.json();
        const requestId = submitData.request_id;
        const statusUrl = submitData.status_url;
        const responseUrl = submitData.response_url;
        if (!requestId || !statusUrl || !responseUrl) {
            await Generation.findByIdAndUpdate(generation._id, { status: 'failed' });
            // Refund credits
            await User.updateOne({ _id: user._id }, { $inc: { credits: creditCost, totalCreditsUsed: -creditCost } });
            return res.status(500).json({ error: 'Failed to queue job on fal.ai' });
        }

        res.status(200).json({ jobId: requestId, status: 'IN_QUEUE', generationId: generation._id, credits: deducted.credits });

        // Poll fal.ai every 5 seconds until the job finishes
        let pollDone = false;
        const poll = setInterval(async () => {
            if (pollDone) return;
            try {
                const pollRes = await fetch(statusUrl, {
                    headers: { 'Authorization': `Key ${FAL_KEY}` }
                });
                const pollData = await pollRes.json();
                const status = pollData.status;

                console.log(`   Polling ${requestId.slice(0, 8)} — ${status}`);

                io.to(safeSessionId).emit('generation_status', { jobId: requestId, status });

                if (status === 'COMPLETED') {
                    pollDone = true;
                    clearInterval(poll);

                    // Fetch the result from fal.ai
                    const resultRes = await fetch(responseUrl, {
                        headers: { 'Authorization': `Key ${FAL_KEY}` }
                    });
                    const resultData = await resultRes.json();

                    const glbUrl = resultData.model_mesh?.url;
                    if (!glbUrl) {
                        await Generation.findByIdAndUpdate(generation._id, { status: 'failed' });
                        await User.updateOne({ _id: user._id }, { $inc: { credits: creditCost, totalCreditsUsed: -creditCost } });
                        const refunded = await User.findById(user._id);
                        io.to(safeSessionId).emit('generation_failed', { error: 'Generation completed but model data was empty', credits: refunded?.credits });
                        return;
                    }

                    // Download the GLB file from fal.ai (URLs expire)
                    const glbRes = await fetch(glbUrl);
                    if (!glbRes.ok) {
                        await Generation.findByIdAndUpdate(generation._id, { status: 'failed' });
                        await User.updateOne({ _id: user._id }, { $inc: { credits: creditCost, totalCreditsUsed: -creditCost } });
                        const refunded = await User.findById(user._id);
                        io.to(safeSessionId).emit('generation_failed', { error: 'Failed to download model file', credits: refunded?.credits });
                        return;
                    }
                    const glbBuffer = Buffer.from(await glbRes.arrayBuffer());

                    const userDir = path.join(TEMP_DIR, safeSessionId);
                    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir);

                    const fileName = `${requestId}.glb`;
                    const filePath = path.join(userDir, fileName);
                    fs.writeFileSync(filePath, glbBuffer);

                    const modelUrl = `${process.env.LOCAL_URL}/models/${safeSessionId}/${fileName}`;

                    // For image mode, use the uploaded reference image as thumbnail
                    let thumbnailUrl = (await Generation.findById(generation._id))?.thumbnail || '';
                    if (!thumbnailUrl && referenceImageUrl) {
                        thumbnailUrl = await downloadImageAsThumb(referenceImageUrl, generation._id.toString());
                    }

                    await Generation.findByIdAndUpdate(generation._id, {
                        status: 'completed',
                        modelPath: filePath,
                        modelUrl,
                        thumbnail: thumbnailUrl
                    });

                    io.to(safeSessionId).emit('generation_complete', {
                        modelUrl,
                        generationId: generation._id,
                        prompt: prompt || '',
                        name: name || '',
                        thumbnail: thumbnailUrl,
                        credits: deducted.credits
                    });

                } else if (pollData.error) {
                    pollDone = true;
                    clearInterval(poll);
                    await Generation.findByIdAndUpdate(generation._id, { status: 'failed' });
                    // Refund credits on poll failure
                    await User.updateOne({ _id: user._id }, { $inc: { credits: creditCost, totalCreditsUsed: -creditCost } });
                    const refunded = await User.findById(user._id);
                    io.to(safeSessionId).emit('generation_failed', { error: pollData.error, credits: refunded?.credits });
                }
            } catch (pollError) {
                console.error(`Polling error for request ${requestId}:`, pollError);
            }
        }, 5000);

    } catch (error) {
        console.error('Generation error:', error);
        await Generation.findByIdAndUpdate(generation._id, { status: 'failed' });
        // Refund credits on catch-all failure
        await User.updateOne({ _id: user._id }, { $inc: { credits: creditCost, totalCreditsUsed: -creditCost } });
        const refunded = await User.findById(user._id);
        io.to(safeSessionId).emit('generation_failed', { error: error.message || 'Failed to start generation', credits: refunded?.credits });
        if (!res.headersSent) res.status(500).json({ error: 'Failed to start generation' });
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

        // Remove GLB file from disk
        if (gen.modelPath && fs.existsSync(gen.modelPath)) {
            fs.unlinkSync(gen.modelPath);
        }
        // Remove thumbnail (try common extensions)
        for (const ext of ['.jpg', '.png', '.svg']) {
            const thumbPath = path.join(THUMB_DIR, `${gen._id}${ext}`);
            if (fs.existsSync(thumbPath)) { fs.unlinkSync(thumbPath); break; }
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