const { fal } = require('@fal-ai/client');

const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const authenticateRequest = require('../../middleware/auth');
const { User } = require('../../models');
const { COST_REMOVE_BG, PUBLIC_URL } = require('../../config');

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
        if (err) return res.status(400).json({ error: err.message });
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const imageUrl = `${PUBLIC_URL}/uploads/${req.file.filename}`;
        res.json({ imageUrl });
    });
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
        const result = await fal.subscribe('fal-ai/imageutils/rembg', {
            input: { image_url: imageUrl }
        });

        const outputUrl = result.data?.image?.url;
        if (!outputUrl) {
            console.error('Remove BG: no image in result', result.data);
            await User.updateOne({ _id: user._id }, { $inc: { credits: COST_REMOVE_BG, totalCreditsUsed: -COST_REMOVE_BG } });
            return res.status(500).json({ error: 'No output image returned', credits: deducted.credits + COST_REMOVE_BG });
        }

        const resultUrl = await saveResultImage(outputUrl);
        console.log(`Remove BG complete → ${resultUrl}`);

        res.json({ success: true, resultUrl, credits: deducted.credits });

    } catch (err) {
        console.error('Remove BG error:', err);
        await User.updateOne({ _id: user._id }, { $inc: { credits: COST_REMOVE_BG, totalCreditsUsed: -COST_REMOVE_BG } });
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
