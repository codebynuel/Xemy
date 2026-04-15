/**
 * Xemy Cross-Use — link tool results to other tools as input.
 *
 * Each tool has a cross-use.json that lists target tools and their
 * accepted input types. After a result is generated, a "What next?"
 * card appears with links to other tools.
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
    let _card = null;

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

    /** Inject cross-use card styles */
    function injectStyles() {
        if (document.getElementById('xemy-crossuse-css')) return;
        const style = document.createElement('style');
        style.id = 'xemy-crossuse-css';
        style.textContent = `
            .xemy-crossuse-card {
                position: absolute;
                bottom: 70px;
                right: 24px;
                z-index: 30;
                width: 220px;
                background: #19191c;
                border: 1px solid rgba(72,71,74,0.2);
                border-radius: 16px;
                padding: 14px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.4);
                animation: crossuse-in 0.25s cubic-bezier(0.34,1.56,0.64,1);
            }
            @keyframes crossuse-in {
                from { opacity: 0; transform: translateY(8px) scale(0.96); }
                to   { opacity: 1; transform: translateY(0) scale(1); }
            }
            .xemy-crossuse-card .cu-header {
                font-family: 'Space Grotesk', sans-serif;
                font-size: 11px;
                font-weight: 600;
                color: #adaaad;
                letter-spacing: 0.02em;
                margin-bottom: 10px;
                display: flex;
                align-items: center;
                gap: 6px;
            }
            .xemy-crossuse-card .cu-header .material-symbols-outlined {
                font-size: 14px;
                color: #b8f147;
            }
            .xemy-crossuse-card .cu-list {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .xemy-crossuse-card .cu-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 8px 10px;
                border-radius: 10px;
                border: 1px solid transparent;
                cursor: pointer;
                transition: all 0.15s ease;
                text-decoration: none;
                color: #f9f5f8;
            }
            .xemy-crossuse-card .cu-item:hover {
                background: rgba(184,241,71,0.08);
                border-color: rgba(184,241,71,0.2);
            }
            .xemy-crossuse-card .cu-item .material-symbols-outlined {
                font-size: 18px;
                color: #adaaad;
                transition: color 0.15s ease;
            }
            .xemy-crossuse-card .cu-item:hover .material-symbols-outlined {
                color: #b8f147;
            }
            .xemy-crossuse-card .cu-item-label {
                font-family: 'Manrope', sans-serif;
                font-size: 11px;
                font-weight: 500;
            }
        `;
        document.head.appendChild(style);
    }

    /** Render cross-use card for the given result URL */
    function showActions(resultUrl) {
        if (!_actions.length) return;
        hideActions();
        injectStyles();

        // Find the main/section viewport area to anchor the card
        const anchor = document.querySelector('main') || document.querySelector('section.flex-1');
        if (!anchor) return;
        anchor.style.position = 'relative';

        _card = document.createElement('div');
        _card.className = 'xemy-crossuse-card';

        const header = document.createElement('div');
        header.className = 'cu-header';
        header.innerHTML = '<span class="material-symbols-outlined">auto_awesome</span> What next?';
        _card.appendChild(header);

        const list = document.createElement('div');
        list.className = 'cu-list';

        for (const action of _actions) {
            const item = document.createElement('a');
            item.className = 'cu-item';
            item.href = '#';
            item.innerHTML = `
                <span class="material-symbols-outlined">${action.icon || 'open_in_new'}</span>
                <span class="cu-item-label">${action.label}</span>
            `;
            item.addEventListener('click', (e) => {
                e.preventDefault();
                send(resultUrl, action);
            });
            list.appendChild(item);
        }

        _card.appendChild(list);
        anchor.appendChild(_card);
    }

    /** Hide cross-use card */
    function hideActions() {
        if (_card) {
            _card.remove();
            _card = null;
        }
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
