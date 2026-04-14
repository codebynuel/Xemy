const mongoose = require('mongoose');
const { CREDITS_FREE } = require('../config');

const userSchema = new mongoose.Schema({
    name:             { type: String },
    email:            { type: String, required: true, unique: true },
    password:         { type: String, required: true },
    credits:          { type: Number, default: CREDITS_FREE },
    plan:             { type: String, enum: ['free', 'starter', 'pro', 'enterprise'], default: 'free' },
    creditsResetAt:   { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    totalCreditsUsed: { type: Number, default: 0 }
});

module.exports = mongoose.model('User', userSchema);
