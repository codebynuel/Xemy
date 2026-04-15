const { fal } = require('@fal-ai/client');

const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const authenticateRequest = require('../../middleware/auth');
const { User, ToolResult } = require('../../models');
const { COST_REMOVE_BG, PUBLIC_URL } = require('../../config');
const log = require('../../logger')('removebg');

fal.config({ credentials: () => process.env.FAL_KEY });

const UPLOAD_DIR  = path.join(__dirname, '../../../temp_models/_uploads');
const OUTPUT_DIR  = path.join(__dirname, '../../../temp_models/_removebg');
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

// Remove background via fal.ai
router.post('/process', async (req, res) => {
    const { imageUrl } = req.body;
    if (!imageUrl) return res.status(400).json({ error: 'Missing imageUrl' });

    const user = await authenticateRequest(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    if (!process.env.FAL_KEY) return res.status(500).json({ error: 'FAL_KEY not configured' });

    // Atomic credit deduction
    const deducted = await User.findOneAndUpdate(
        { _id: user._id, credits: { $gte: COST_REMOVE_BG } },
        { $inc: { credits: -COST_REMOVE_BG, totalCreditsUsed: COST_REMOVE_BG } },
        { new: true }
    );
    if (!deducted) {
        return res.status(403).json({ error: 'Insufficient credits', credits: user.credits, required: COST_REMOVE_BG });
    }

    try {
        log.api('fal-ai/imageutils/rembg', 'subscribe', { imageUrl, userId: user._id.toString() });
        const startTime = Date.now();

        const result = await fal.subscribe('fal-ai/imageutils/rembg', {
            input: { image_url: imageUrl }
        });

        const duration = Date.now() - startTime;
        log.api('fal-ai/imageutils/rembg', 'complete', { duration: `${duration}ms` });

        const outputUrl = result.data?.image?.url;
        if (!outputUrl) {
            log.error('No image in result', { resultData: result.data });
            await User.updateOne({ _id: user._id }, { $inc: { credits: COST_REMOVE_BG, totalCreditsUsed: -COST_REMOVE_BG } });
            log.credits('refunded', { userId: user._id.toString(), amount: COST_REMOVE_BG, reason: 'no output' });
            return res.status(500).json({ error: 'No output image returned', credits: deducted.credits + COST_REMOVE_BG });
        }

        const resultUrl = await saveResultImage(outputUrl);
        log.info('Remove BG complete', { resultUrl, duration: `${duration}ms` });

        const historyEntry = await ToolResult.create({
            userId: user._id,
            tool: 'removebg',
            originalUrl: imageUrl,
            resultUrl,
            metadata: { duration }
        });

        res.json({ success: true, resultUrl, credits: deducted.credits, historyId: historyEntry._id });

    } catch (err) {
        log.error('Remove BG failed', { error: err.message });
        if (err.body) log.error('API error detail', { body: err.body });
        await User.updateOne({ _id: user._id }, { $inc: { credits: COST_REMOVE_BG, totalCreditsUsed: -COST_REMOVE_BG } });
        log.credits('refunded', { userId: user._id.toString(), amount: COST_REMOVE_BG, reason: 'api error' });
        const refunded = await User.findById(user._id);
        res.status(500).json({ error: 'Background removal failed', credits: refunded?.credits });
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
    return `/removebg/${fileName}`;
}

module.exports = router;
module.exports.saveResultImage = saveResultImage;
