// ─────────────────────────────────────────────────────────
// Xemy Logger — structured console logger
// Maps to console.log for now; later can route to Discord
// webhooks, a log service, or file transport.
// ─────────────────────────────────────────────────────────

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LEVEL_LABELS = { debug: 'DBG', info: 'INF', warn: 'WRN', error: 'ERR' };
const LEVEL_COLORS = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL || 'debug'];

function timestamp() {
    return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

function formatMeta(meta) {
    if (!meta || Object.keys(meta).length === 0) return '';
    const parts = Object.entries(meta).map(([k, v]) => {
        const val = typeof v === 'object' ? JSON.stringify(v) : v;
        return `${DIM}${k}=${RESET}${val}`;
    });
    return ' ' + parts.join(' ');
}

function log(level, module, message, meta) {
    if (LEVELS[level] < MIN_LEVEL) return;

    const color = LEVEL_COLORS[level];
    const label = LEVEL_LABELS[level];
    const ts = timestamp();
    const mod = module ? `${BOLD}[${module}]${RESET}` : '';

    const line = `${DIM}${ts}${RESET} ${color}${label}${RESET} ${mod} ${message}${formatMeta(meta)}`;

    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
}

/**
 * Create a scoped logger for a module.
 *
 * Usage:
 *   const log = require('./logger')('auth');
 *   log.info('User logged in', { userId: '123', ip: '…' });
 *   log.error('Login failed', { email, reason: 'bad password' });
 *   log.api('fal-ai/rembg', 'subscribe', { duration: 1240 });
 *   log.credits('deducted', { userId, cost: 10, remaining: 140 });
 */
function createLogger(module) {
    return {
        debug: (msg, meta) => log('debug', module, msg, meta),
        info:  (msg, meta) => log('info',  module, msg, meta),
        warn:  (msg, meta) => log('warn',  module, msg, meta),
        error: (msg, meta) => log('error', module, msg, meta),

        // Semantic helpers
        api(service, action, meta) {
            log('info', module, `API ${action} → ${service}`, meta);
        },
        credits(action, meta) {
            log('info', module, `Credits ${action}`, meta);
        },
        request(method, path, meta) {
            log('info', module, `${method} ${path}`, meta);
        },
    };
}

module.exports = createLogger;
