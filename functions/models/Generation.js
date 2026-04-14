const mongoose = require('mongoose');

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
    textureApplied: { type: Boolean, default: false },
    createdAt:      { type: Date, default: Date.now }
});

generationSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Generation', generationSchema);
