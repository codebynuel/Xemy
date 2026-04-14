const router = require('express').Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Models = require('../../models');
const { CREDITS_FREE, PLAN_CREDITS, COST_TEXT_TO_3D, COST_IMAGE_TO_3D, COST_MULTI_IMAGE_TO_3D, COST_TEXTURE, COST_REMOVE_BG } = require('../../config');

router.post('/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const existingUser = await Models.User.findOne({ email });
        if (existingUser) return res.status(400).json({ error: 'User already exists' });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new Models.User({
            name,
            email,
            password: hashedPassword,
            credits: CREDITS_FREE,
            plan: 'free',
            creditsResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        });
        await newUser.save();

        const token = jwt.sign({ userId: newUser._id }, process.env.JWT_SECRET || 'xemy_secret', { expiresIn: '7d' });
        res.cookie('authToken', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 });
        res.status(201).json({ message: 'Account created successfully', authenticated: true });
    } catch (error) {
        console.error('Registration Error:', error);
        res.status(500).json({ error: 'Failed to create account' });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await Models.User.findOne({ email });
        if (!user) return res.status(400).json({ error: 'Invalid email or password' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: 'Invalid email or password' });

        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'xemy_secret', { expiresIn: '7d' });
        res.cookie('authToken', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 });
        res.status(200).json({ message: 'Login successful', authenticated: true });
    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

router.get('/verify', async (req, res) => {
    try {
        const token = req.cookies.authToken;
        if (!token) return res.status(401).json({ authenticated: false });

        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'xemy_secret');
        const user = await Models.User.findById(decoded.userId);
        if (!user) return res.status(401).json({ authenticated: false });

        // Lazy monthly credit reset
        if (user.creditsResetAt && user.creditsResetAt <= new Date()) {
            const allowance = PLAN_CREDITS[user.plan] ?? CREDITS_FREE;
            user.credits = allowance;
            user.creditsResetAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
            await user.save();
        }

        res.status(200).json({
            authenticated: true,
            user: { id: user._id, name: user.name, email: user.email },
            credits: user.credits,
            plan: user.plan,
            creditsResetAt: user.creditsResetAt,
            costs: { text: COST_TEXT_TO_3D, image: COST_IMAGE_TO_3D, multiImage: COST_MULTI_IMAGE_TO_3D, texture: COST_TEXTURE, removeBg: COST_REMOVE_BG }
        });
    } catch (error) {
        res.status(401).json({ authenticated: false });
    }
});

router.post('/logout', (req, res) => {
    res.clearCookie('authToken');
    res.status(200).json({ message: 'Logout successful' });
});

module.exports = router;