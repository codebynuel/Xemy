const REMOVE_BG_URI = process.env.REMOVE_BG_URI;

const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const authenticateRequest = require('../../middleware/auth');
const { User } = require('../../models');
const { COST_REMOVE_BG, PUBLIC_URL } = require('../../config');

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
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const imageUrl = `${PUBLIC_URL}/uploads/${req.file.filename}`;
        res.json({ imageUrl });
    });
});

// Remove background via fal.ai bria
router.post('/process', async (req, res) => {
    const { imageUrl } = req.body;
    if (!imageUrl) return res.status(400).json({ error: 'Missing imageUrl' });

    const user = await authenticateRequest(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    const FAL_KEY = process.env.FAL_KEY;
    if (!FAL_KEY) return res.status(500).json({ error: 'FAL_KEY not configured' });

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
        // Submit to fal.ai queue
        const submitRes = await fetch(REMOVE_BG_URI, {
            method: 'POST',
            headers: {
                'Authorization': `Key ${FAL_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ image_url: imageUrl })
        });
        const submitData = await submitRes.json();

        // Handle synchronous response (result returned immediately)
        if (submitData.image?.url) {
            const resultUrl = await saveResultImage(submitData.image.url);
            return res.json({ success: true, resultUrl, credits: deducted.credits });
        }

        const { request_id, status_url, response_url } = submitData;
        console.log('Remove BG submitted:', { request_id, status_url, response_url });
        if (!request_id || !status_url || !response_url) {
            // Refund on queue failure
            await User.updateOne({ _id: user._id }, { $inc: { credits: COST_REMOVE_BG, totalCreditsUsed: -COST_REMOVE_BG } });
            return res.status(500).json({ error: 'Failed to remove background' });
        }

        // Poll for completion
        for (let i = 0; i < 60; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const pollRes = await fetch(status_url, { headers: { 'Authorization': `Key ${FAL_KEY}` } });
            const pollData = await pollRes.json();

            if (pollData.status === 'COMPLETED') break;
            if (pollData.status === 'FAILED' || pollData.error) {
                console.error('Remove BG failed:', pollData.error || 'Unknown error');
                await User.updateOne({ _id: user._id }, { $inc: { credits: COST_REMOVE_BG, totalCreditsUsed: -COST_REMOVE_BG } });
                return res.status(500).json({ error: 'Background removal failed' });
            }
        }

        // Fetch result
        const resultRes = await fetch(response_url, { headers: { 'Authorization': `Key ${FAL_KEY}` } });
        const resultData = await resultRes.json();
        const outputUrl = resultData.image?.url;

        if (!outputUrl) {
            await User.updateOne({ _id: user._id }, { $inc: { credits: COST_REMOVE_BG, totalCreditsUsed: -COST_REMOVE_BG } });
            return res.status(500).json({ error: 'No output image returned' });
        }

        const resultUrl = await saveResultImage(outputUrl);
        res.json({ success: true, resultUrl, credits: deducted.credits });

    } catch (err) {
        console.error('Remove BG error:', err);
        // Refund on unexpected failure
        await User.updateOne({ _id: user._id }, { $inc: { credits: COST_REMOVE_BG, totalCreditsUsed: -COST_REMOVE_BG } });
        res.status(500).json({ error: 'Background removal failed' });
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
