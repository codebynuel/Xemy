const jwt = require('jsonwebtoken');
const { User } = require('../models');

async function authenticateRequest(req) {
    try {
        const token = req.cookies.authToken;
        if (!token) return null;
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'xemy_secret');
        return await User.findById(decoded.userId);
    } catch {
        return null;
    }
}

module.exports = authenticateRequest;
