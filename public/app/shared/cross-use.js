/**
 * Xemy Cross-Use — link tool results to other tools as input.
 *
 * Each tool has a cross-use.json that lists target tools and their
 * accepted input types. After a result is generated, cross-use buttons
 * appear in the toolbar so the user can send that result to another tool.
 *
 * Data flow:  Tool A result → sessionStorage → Tool B reads on load.
 *
 * Usage in each tool's app.js:
 *   // After result is shown:
 *   XemyCrossUse.showActions(resultUrl);
 *
 *   // On page load (in init / checkAuth callback):
 *   const incoming = XemyCrossUse.receive();
 *   if (incoming) handleUrl(incoming.url);
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'xemy_crossuse';
    let _actions = [];
    let _container = null;

    /** Load cross-use.json for this tool (relative to tool's folder) */
    async function loadConfig() {
        try {
            const res = await fetch('cross-use.json');
            if (!res.ok) return [];
            const data = await res.json();
            return Array.isArray(data.actions) ? data.actions : [];
        } catch {
            return [];
        }
    }

    /** Ensure the button container exists inside toolbar */
    function ensureContainer() {
        if (_container) return _container;
        const toolbar = document.getElementById('toolbar');
        if (!toolbar) return null;

        // Add separator
        const sep = document.createElement('div');
        sep.className = 'w-px h-6 bg-outline-variant/20 mx-1 cross-use-sep hidden';
        toolbar.appendChild(sep);

        _container = document.createElement('div');
        _container.id = 'cross-use-actions';
        _container.className = 'flex items-center gap-1 hidden';
        toolbar.appendChild(_container);
        return _container;
    }

    /** Render cross-use action buttons for the given result URL */
    function showActions(resultUrl) {
        const container = ensureContainer();
        if (!container || !_actions.length) return;

        container.innerHTML = '';
        container.classList.remove('hidden');
        const sep = document.querySelector('.cross-use-sep');
        if (sep) sep.classList.remove('hidden');

        for (const action of _actions) {
            const btn = document.createElement('button');
            btn.title = action.label;
            btn.className = 'p-2 rounded-xl hover:bg-primary/20 text-primary-fixed-dim border border-outline-variant/15 transition-colors flex items-center gap-1';
            btn.innerHTML = `<span class="material-symbols-outlined text-lg">${action.icon || 'open_in_new'}</span>`;
            if (action.shortLabel) {
                const span = document.createElement('span');
                span.className = 'text-[10px] font-label font-medium hidden sm:inline';
                span.textContent = action.shortLabel;
                btn.appendChild(span);
            }
            btn.addEventListener('click', () => send(resultUrl, action));
            container.appendChild(btn);
        }
    }

    /** Hide cross-use actions (e.g. on reset) */
    function hideActions() {
        if (_container) {
            _container.classList.add('hidden');
            _container.innerHTML = '';
        }
        const sep = document.querySelector('.cross-use-sep');
        if (sep) sep.classList.add('hidden');
    }

    /** Store result URL in sessionStorage and navigate to target tool */
    function send(resultUrl, action) {
        // If result is a relative path, make it absolute
        const fullUrl = resultUrl.startsWith('http') ? resultUrl : window.location.origin + resultUrl;
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
            url: fullUrl,
            fromTool: document.body.dataset.page || '',
            timestamp: Date.now()
        }));
        window.location.href = action.href;
    }

    /** Check if there's an incoming cross-use payload, consume it */
    function receive() {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        sessionStorage.removeItem(STORAGE_KEY);
        try {
            const data = JSON.parse(raw);
            // Expire after 5 minutes
            if (Date.now() - data.timestamp > 5 * 60 * 1000) return null;
            return data;
        } catch {
            return null;
        }
    }

    // Init: load config
    loadConfig().then(actions => { _actions = actions; });

    // Expose globally
    window.XemyCrossUse = { showActions, hideActions, receive };
})();
