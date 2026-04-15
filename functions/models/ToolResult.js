const mongoose = require('mongoose');

const toolResultSchema = new mongoose.Schema({
    userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tool:        { type: String, enum: ['removebg', 'upscaler', 'vectorize'], required: true },
    originalUrl: { type: String, default: '' },
    resultUrl:   { type: String, required: true },
    metadata:    { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt:   { type: Date, default: Date.now }
});

toolResultSchema.index({ userId: 1, tool: 1, createdAt: -1 });

module.exports = mongoose.model('ToolResult', toolResultSchema);
