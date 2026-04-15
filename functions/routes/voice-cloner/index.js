const { fal } = require('@fal-ai/client');

const router = require('express').Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const authenticateRequest = require('../../middleware/auth');
const { User, ToolResult } = require('../../models');
const { PUBLIC_URL } = require('../../config');
const log = require('../../logger')('voicecloner');

fal.config({ credentials: () => process.env.FAL_KEY });

const UPLOAD_DIR = path.join(__dirname, '../../../temp_models/_uploads');
const OUTPUT_DIR = path.join(__dirname, '../../../temp_models/_voicecloner');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, UPLOAD_DIR),
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase();
            const allowed = ['.mp3', '.wav', '.ogg', '.webm', '.m4a', '.flac', '.aac'];
            if (!allowed.includes(ext)) return cb(new Error('Invalid audio file type'));
            cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
        }
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('audio/') || file.mimetype === 'video/webm') cb(null, true);
        else cb(new Error('Only audio files are allowed'));
    }
});

/** Calculate token cost: ceil(chars / 1000) * 100 */
function calcCost(charCount) {
    return Math.ceil(charCount / 1000) * 100;
}

// Upload reference audio (returns public URL)
router.post('/upload', async (req, res) => {
    const user = await authenticateRequest(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    upload.single('audio')(req, res, (err) => {
        if (err) { log.warn('Upload failed', { error: err.message }); return res.status(400).json({ error: err.message }); }
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const audioUrl = `${PUBLIC_URL}/uploads/${req.file.filename}`;
        log.info('Audio uploaded', { file: req.file.filename, size: req.file.size, userId: user._id.toString() });
        res.json({ audioUrl });
    });
});

// Upload reference audio from URL
router.post('/upload-url', async (req, res) => {
    const user = await authenticateRequest(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    const { url } = req.body;
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Missing url' });

    try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).json({ error: 'Invalid URL protocol' });

        const audioRes = await fetch(url);
        if (!audioRes.ok) return res.status(400).json({ error: 'Failed to fetch audio from URL' });

        const contentType = audioRes.headers.get('content-type') || '';
        if (!contentType.startsWith('audio/') && contentType !== 'video/webm') {
            return res.status(400).json({ error: 'URL does not point to an audio file' });
        }

        const buffer = Buffer.from(await audioRes.arrayBuffer());
        if (buffer.length > 20 * 1024 * 1024) return res.status(400).json({ error: 'Audio too large (max 20MB)' });

        const extMap = { 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'audio/ogg': '.ogg', 'audio/webm': '.webm', 'video/webm': '.webm', 'audio/mp4': '.m4a', 'audio/flac': '.flac', 'audio/aac': '.aac' };
        const ext = extMap[contentType.split(';')[0]] || '.wav';
        const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
        fs.writeFileSync(path.join(UPLOAD_DIR, fileName), buffer);
        const audioUrl = `${PUBLIC_URL}/uploads/${fileName}`;
        log.info('Audio uploaded from URL', { file: fileName, size: buffer.length, userId: user._id.toString() });
        res.json({ audioUrl });
    } catch (err) {
        log.error('URL upload failed', { error: err.message });
        res.status(400).json({ error: 'Failed to fetch audio from URL' });
    }
});

// Clone voice via fal.ai F5-TTS
router.post('/process', async (req, res) => {
    const { audioUrl, refText, genText } = req.body;
    if (!audioUrl) return res.status(400).json({ error: 'Missing reference audio URL' });
    if (!genText || typeof genText !== 'string') return res.status(400).json({ error: 'Missing text to convert' });

    const trimmed = genText.trim();
    if (trimmed.length < 1) return res.status(400).json({ error: 'Text must be at least 1 character' });
    if (trimmed.length > 5000) return res.status(400).json({ error: 'Text exceeds 5000 character limit' });

    const user = await authenticateRequest(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    if (!process.env.FAL_KEY) return res.status(500).json({ error: 'FAL_KEY not configured' });

    const cost = calcCost(trimmed.length);

    // Atomic credit deduction
    const deducted = await User.findOneAndUpdate(
        { _id: user._id, credits: { $gte: cost } },
        { $inc: { credits: -cost, totalCreditsUsed: cost } },
        { new: true }
    );
    if (!deducted) {
        return res.status(403).json({ error: 'Insufficient credits', credits: user.credits, required: cost });
    }

    try {
        const input = {
            gen_text: trimmed,
            ref_audio_url: audioUrl,
            model_type: 'F5-TTS',
            remove_silence: true
        };
        if (refText && typeof refText === 'string' && refText.trim()) {
            input.ref_text = refText.trim();
        }

        log.api('fal-ai/f5-tts', 'subscribe', { charCount: trimmed.length, cost, userId: user._id.toString() });
        const startTime = Date.now();

        const result = await fal.subscribe('fal-ai/f5-tts', { input });

        const duration = Date.now() - startTime;
        log.api('fal-ai/f5-tts', 'complete', { duration: `${duration}ms` });

        const outputUrl = result.data?.audio_url?.url;
        if (!outputUrl) {
            log.error('No audio in result', { resultData: result.data });
            await User.updateOne({ _id: user._id }, { $inc: { credits: cost, totalCreditsUsed: -cost } });
            log.credits('refunded', { userId: user._id.toString(), amount: cost, reason: 'no output' });
            return res.status(500).json({ error: 'No output audio returned', credits: deducted.credits + cost });
        }

        const resultUrl = await saveResultAudio(outputUrl);
        log.info('Voice clone complete', { resultUrl, duration: `${duration}ms`, charCount: trimmed.length });

        const historyEntry = await ToolResult.create({
            userId: user._id,
            tool: 'voicecloner',
            originalUrl: audioUrl,
            resultUrl,
            metadata: { duration, charCount: trimmed.length, cost }
        });

        res.json({ success: true, resultUrl, credits: deducted.credits, historyId: historyEntry._id, cost });

    } catch (err) {
        log.error('Voice clone failed', { error: err.message });
        if (err.body) log.error('API error detail', { body: err.body });
        await User.updateOne({ _id: user._id }, { $inc: { credits: cost, totalCreditsUsed: -cost } });
        log.credits('refunded', { userId: user._id.toString(), amount: cost, reason: 'api error' });
        const refunded = await User.findById(user._id);
        res.status(500).json({ error: 'Voice cloning failed', credits: refunded?.credits });
    }
});

// Download fal.ai result and save locally (URLs expire)
async function saveResultAudio(remoteUrl) {
    const audioRes = await fetch(remoteUrl);
    if (!audioRes.ok) throw new Error('Failed to download result audio');
    const buffer = Buffer.from(await audioRes.arrayBuffer());
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.wav`;
    const filePath = path.join(OUTPUT_DIR, fileName);
    fs.writeFileSync(filePath, buffer);
    return `/voicecloner/${fileName}`;
}

module.exports = router;
