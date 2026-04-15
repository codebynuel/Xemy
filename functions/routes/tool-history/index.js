const router = require('express').Router();
const authenticateRequest = require('../../middleware/auth');
const { ToolResult } = require('../../models');
const log = require('../../logger')('history');

// List recent results for a tool
router.get('/:tool', async (req, res) => {
    const user = await authenticateRequest(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    const validTools = ['removebg', 'upscaler', 'vectorize'];
    const tool = req.params.tool;
    if (!validTools.includes(tool)) return res.status(400).json({ error: 'Invalid tool' });

    try {
        const results = await ToolResult.find({ userId: user._id, tool })
            .sort({ createdAt: -1 })
            .limit(30)
            .lean();
        log.info('History fetched', { tool, count: results.length, userId: user._id.toString() });
        res.json(results);
    } catch (err) {
        log.error('History fetch failed', { error: err.message });
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

// Delete a history entry
router.delete('/:id', async (req, res) => {
    const user = await authenticateRequest(req);
    if (!user) return res.status(401).json({ error: 'Not authenticated' });

    try {
        const entry = await ToolResult.findOneAndDelete({ _id: req.params.id, userId: user._id });
        if (!entry) return res.status(404).json({ error: 'Entry not found' });
        log.info('History entry deleted', { id: req.params.id, tool: entry.tool });
        res.json({ success: true });
    } catch (err) {
        log.error('History delete failed', { error: err.message });
        res.status(500).json({ error: 'Failed to delete entry' });
    }
});

module.exports = router;
