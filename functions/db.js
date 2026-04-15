const mongoose = require('mongoose');
const log = require('./logger')('db');

mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/xemy')
    .then(() => log.info('Connected to MongoDB'))
    .catch(err => log.error('MongoDB connection failed', { error: err.message }));
