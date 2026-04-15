const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const authenticateRequest = require('../../middleware/auth');
const { User, Generation } = require('../../models');
const {
    COST_TEXT_TO_3D, COST_IMAGE_TO_3D, COST_MULTI_IMAGE_TO_3D, COST_TEXTURE,
    PUBLIC_URL, LOCAL_URL
} = require('../../config');
const { generateImageFromText, downloadImageAsThumb } = require('./helpers');
const log = require('../../logger')('3d-gen');

const TEMP_DIR   = path.join(__dirname, '../../../temp_models');
const THUMB_DIR  = path.join(__dirname, '../../../temp_models/_thumbnails');
const UPLOAD_DIR = path.join(__dirname, '../../../temp_models/_uploads');

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

// ---------------------------------------------------------
// Upload reference image
// ---------------------------------------------------------
router.post('/upload-image', async (req, res) => {
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
// Trigger 3D model generation (fal.ai TRELLIS)
// ---------------------------------------------------------
router.post('/generate', async (req, res) => {
    const { mode, prompt, imageUrl, imageUrls, sessionId, name } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });
    if (mode === 'text' && !prompt) return res.status(400).json({ error: 'Missing prompt' });
    if (mode === 'image' && !imageUrl && (!imageUrls || !imageUrls.length)) return res.status(400).json({ error: 'Missing image(s)' });

    const user = await authenticateRequest(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    const safeSessionId = path.basename(sessionId);
    if (!safeSessionId || safeSessionId !== sessionId) {
        return res.status(400).json({ error: 'Invalid session ID' });
    }

    const io = req.app.get('io');
    const FAL_KEY = process.env.FAL_KEY;

    const isMultiImage = Array.isArray(imageUrls) && imageUrls.length > 1;
    const creditCost = isMultiImage ? COST_MULTI_IMAGE_TO_3D
                     : mode === 'text' ? COST_TEXT_TO_3D
                     : COST_IMAGE_TO_3D;

    // Atomic credit deduction
    const deducted = await User.findOneAndUpdate(
        { _id: user._id, credits: { $gte: creditCost } },
        { $inc: { credits: -creditCost, totalCreditsUsed: creditCost } },
        { new: true }
    );
    if (!deducted) {
        return res.status(403).json({ error: 'Insufficient credits', credits: user.credits, required: creditCost });
    }

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
        log.error('Failed to create generation record', { error: dbErr.message });
        return res.status(500).json({ error: 'Database error' });
    }

    try {
        let referenceImageUrl = imageUrl;

        // Text mode: generate reference image via fal.ai FLUX first
        if (mode === 'text') {
            io.to(safeSessionId).emit('generation_status', { status: 'GENERATING_IMAGE' });
            log.info('Generating reference image via FLUX', { prompt: prompt.slice(0, 80) });
            referenceImageUrl = await generateImageFromText(prompt);

            const thumbnailUrl = await downloadImageAsThumb(referenceImageUrl, generation._id.toString());
            await Generation.findByIdAndUpdate(generation._id, { referenceImage: referenceImageUrl, thumbnail: thumbnailUrl });
        }

        // Submit to fal.ai TRELLIS (single or multi-image)
        io.to(safeSessionId).emit('generation_status', { status: 'IN_QUEUE' });
        log.api('TRELLIS', 'submitting', { isMultiImage, endpoint: trellisEndpoint });

        const TRELLIS_URI = process.env.TRELLIS_URI;
        const trellisEndpoint = isMultiImage
            ? `${TRELLIS_URI}/multi-image`
            : TRELLIS_URI;
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
            log.error('TRELLIS did not return queue URLs', { submitData });
            await Generation.findByIdAndUpdate(generation._id, { status: 'failed' });
            await User.updateOne({ _id: user._id }, { $inc: { credits: creditCost, totalCreditsUsed: -creditCost } });
            return res.status(500).json({ error: 'Failed to generate model' });
        }

        res.status(200).json({ jobId: requestId, status: 'IN_QUEUE', generationId: generation._id, credits: deducted.credits });
        log.info('Generation queued', { requestId: requestId.slice(0, 8), mode, generationId: generation._id.toString(), credits: deducted.credits });

        // Poll fal.ai every 5s until the job finishes
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
                    log.info('TRELLIS generation completed', { requestId: requestId.slice(0, 8) });

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

                    const modelUrl = `${LOCAL_URL}/models/${safeSessionId}/${fileName}`;

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
                        credits: deducted.credits,
                        textureApplied: false
                    });

                } else if (pollData.error) {
                    pollDone = true;
                    clearInterval(poll);
                    await Generation.findByIdAndUpdate(generation._id, { status: 'failed' });
                    await User.updateOne({ _id: user._id }, { $inc: { credits: creditCost, totalCreditsUsed: -creditCost } });
                    const refunded = await User.findById(user._id);
                    io.to(safeSessionId).emit('generation_failed', { error: pollData.error, credits: refunded?.credits });
                }
            } catch (pollError) {
                log.error('Polling error', { requestId: requestId.slice(0, 8), error: pollError.message });
            }
        }, 5000);

    } catch (error) {
        log.error('Generation error', { error: error.message, mode, generationId: generation?._id?.toString() });
        await Generation.findByIdAndUpdate(generation._id, { status: 'failed' });
        await User.updateOne({ _id: user._id }, { $inc: { credits: creditCost, totalCreditsUsed: -creditCost } });
        const refunded = await User.findById(user._id);
        io.to(safeSessionId).emit('generation_failed', { error: error.message || 'Failed to start generation', credits: refunded?.credits });
        if (!res.headersSent) res.status(500).json({ error: 'Failed to start generation' });
    }
});

// ---------------------------------------------------------
// Apply texture (costs credits)
// ---------------------------------------------------------
router.post('/generations/:id/apply-texture', async (req, res) => {
    const user = await authenticateRequest(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    try {
        const gen = await Generation.findOne({ _id: req.params.id, userId: user._id, status: 'completed' });
        if (!gen) return res.status(404).json({ error: 'Generation not found' });

        if (gen.textureApplied) {
            return res.json({ success: true, credits: user.credits, alreadyApplied: true });
        }

        const deducted = await User.findOneAndUpdate(
            { _id: user._id, credits: { $gte: COST_TEXTURE } },
            { $inc: { credits: -COST_TEXTURE, totalCreditsUsed: COST_TEXTURE } },
            { new: true }
        );
        if (!deducted) {
            return res.status(403).json({ error: 'Insufficient credits', credits: user.credits, required: COST_TEXTURE });
        }

        gen.textureApplied = true;
        await gen.save();

        res.json({ success: true, credits: deducted.credits });
    } catch (err) {
        log.error('Apply texture error', { error: err.message, generationId: req.params.id });
        res.status(500).json({ error: 'Failed to apply texture' });
    }
});

// ---------------------------------------------------------
// List generations
// ---------------------------------------------------------
router.get('/generations', async (req, res) => {
    const user = await authenticateRequest(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    try {
        const generations = await Generation.find({ userId: user._id, status: 'completed' })
            .sort({ createdAt: -1 })
            .limit(50)
            .select('prompt name modelUrl thumbnail textureApplied createdAt');
        res.json(generations);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch generations' });
    }
});

// ---------------------------------------------------------
// Update generation
// ---------------------------------------------------------
router.put('/generations/:id', async (req, res) => {
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

// ---------------------------------------------------------
// Delete generation
// ---------------------------------------------------------
router.delete('/generations/:id', async (req, res) => {
    const user = await authenticateRequest(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    try {
        const gen = await Generation.findOne({ _id: req.params.id, userId: user._id });
        if (!gen) return res.status(404).json({ error: 'Generation not found' });

        if (gen.modelPath && fs.existsSync(gen.modelPath)) {
            fs.unlinkSync(gen.modelPath);
        }
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

module.exports = router;
