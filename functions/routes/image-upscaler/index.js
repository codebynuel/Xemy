const { fal } = require('@fal-ai/client');

const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const authenticateRequest = require('../../middleware/auth');
const { User, ToolResult } = require('../../models');
const { COST_UPSCALER, PUBLIC_URL } = require('../../config');
const log = require('../../logger')('upscaler');

fal.config({ credentials: () => process.env.FAL_KEY });

const UPLOAD_DIR = path.join(__dirname, '../../../temp_models/_uploads');
const OUTPUT_DIR = path.join(__dirname, '../../../temp_models/_upscaler');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

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

// Upload image (returns public URL for preview)
router.post('/upload', async (req, res) => {
    const user = await authenticateRequest(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    upload.single('image')(req, res, (err) => {
        if (err) { log.warn('Upload failed', { error: err.message }); return res.status(400).json({ error: err.message }); }
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const imageUrl = `${PUBLIC_URL}/uploads/${req.file.filename}`;
        log.info('Image uploaded', { file: req.file.filename, size: req.file.size, userId: user._id.toString() });
        res.json({ imageUrl });
    });
});

// Upload image from URL
router.post('/upload-url', async (req, res) => {
    const user = await authenticateRequest(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    const { url } = req.body;
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Missing url' });

    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).json({ error: 'Invalid URL protocol' });

        const imgRes = await fetch(url);
        if (!imgRes.ok) return res.status(400).json({ error: 'Failed to fetch image from URL' });

        const contentType = imgRes.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) return res.status(400).json({ error: 'URL does not point to an image' });

        const buffer = Buffer.from(await imgRes.arrayBuffer());
        if (buffer.length > 20 * 1024 * 1024) return res.status(400).json({ error: 'Image too large (max 20MB)' });

        const extMap = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
        const ext = extMap[contentType.split(';')[0]] || '.png';
        const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
        fs.writeFileSync(path.join(UPLOAD_DIR, fileName), buffer);
        const imageUrl = `${PUBLIC_URL}/uploads/${fileName}`;
        log.info('Image uploaded from URL', { file: fileName, size: buffer.length, userId: user._id.toString() });
        res.json({ imageUrl });
    } catch (err) {
        log.error('URL upload failed', { error: err.message });
        res.status(400).json({ error: 'Failed to fetch image from URL' });
    }
});

// Upscale image via fal.ai
router.post('/process', async (req, res) => {
    const { imageUrl, scale } = req.body;
    if (!imageUrl) return res.status(400).json({ error: 'Missing imageUrl' });

    const upscaleFactor = [2, 4].includes(scale) ? scale : 2;

    const user = await authenticateRequest(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    if (!process.env.FAL_KEY) return res.status(500).json({ error: 'FAL_KEY not configured' });

    // Atomic credit deduction
    const deducted = await User.findOneAndUpdate(
        { _id: user._id, credits: { $gte: COST_UPSCALER } },
        { $inc: { credits: -COST_UPSCALER, totalCreditsUsed: COST_UPSCALER } },
        { new: true }
    );
    if (!deducted) {
        return res.status(403).json({ error: 'Insufficient credits', credits: user.credits, required: COST_UPSCALER });
    }

    try {
        log.api('fal-ai/creative-upscaler', 'subscribe', { imageUrl, scale: upscaleFactor, userId: user._id.toString() });
        const startTime = Date.now();

        const result = await fal.subscribe('fal-ai/creative-upscaler', {
            input: {
                image_url: imageUrl,
                scale: upscaleFactor,
                creativity: 0,
                detail: 1,
                shape_preservation: 0.25,
                prompt: ''
            }
        });

        const duration = Date.now() - startTime;
        log.api('fal-ai/creative-upscaler', 'complete', { duration: `${duration}ms`, scale: upscaleFactor });

        const outputUrl = result.data?.image?.url;
        if (!outputUrl) {
            log.error('No image in result', { resultData: result.data });
            await User.updateOne({ _id: user._id }, { $inc: { credits: COST_UPSCALER, totalCreditsUsed: -COST_UPSCALER } });
            log.credits('refunded', { userId: user._id.toString(), amount: COST_UPSCALER, reason: 'no output' });
            return res.status(500).json({ error: 'No output image returned', credits: deducted.credits + COST_UPSCALER });
        }

        const resultUrl = await saveResultImage(outputUrl);

        // Get dimensions from the result if available
        const width = result.data?.image?.width;
        const height = result.data?.image?.height;
        log.info('Upscale complete', { resultUrl, width, height, duration: `${duration}ms` });

        const historyEntry = await ToolResult.create({
            userId: user._id,
            tool: 'upscaler',
            originalUrl: imageUrl,
            resultUrl,
            metadata: { scale: upscaleFactor, width, height, originalWidth: result.data?.image?.original_width, originalHeight: result.data?.image?.original_height, duration }
        });

        res.json({
            success: true,
            resultUrl,
            credits: deducted.credits,
            width,
            height,
            originalWidth: result.data?.image?.original_width,
            originalHeight: result.data?.image?.original_height,
            historyId: historyEntry._id
        });

    } catch (err) {
        console.error(err);
        log.error('Upscale failed', { error: err.message });
        if (err.body) log.error('API error detail', { body: err.body });
        await User.updateOne({ _id: user._id }, { $inc: { credits: COST_UPSCALER, totalCreditsUsed: -COST_UPSCALER } });
        log.credits('refunded', { userId: user._id.toString(), amount: COST_UPSCALER, reason: 'api error' });
        const refunded = await User.findById(user._id);
        res.status(500).json({ error: 'Image upscaling failed', credits: refunded?.credits });
    }
});

// Download fal.ai result and save locally (URLs expire)
async function saveResultImage(remoteUrl) {
    const imgRes = await fetch(remoteUrl);
    if (!imgRes.ok) throw new Error('Failed to download result image');
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
    const filePath = path.join(OUTPUT_DIR, fileName);
    fs.writeFileSync(filePath, buffer);
    return `/upscaler/${fileName}`;
}

module.exports = router;
