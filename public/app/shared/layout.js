/**
 * Xemy Shared Layout — sidebar + full header
 *
 * Usage:
 *   1. Add  data-page="<key>"  to <body>
 *   2. Place  <div id="sidebar-mount"></div>  before #app-layout
 *   3. Place  <div id="header-mount"></div>  where the header goes (replaces entire <header>)
 *   4. <script src="/app/shared/layout.js"></script>  (anywhere before </body>)
 *
 * Page keys: "3d" | "removebg"
 * To add a new tool: add one entry to NAV_LINKS — no HTML changes needed.
 */
(function () {
    'use strict';

    // ── Tool nav entries — edit here to add/remove tools ─────────────────────
    const NAV_LINKS = [
        { page: '3d',       href: '/app/3d.model.creator/', icon: 'view_in_ar',  label: '3D Model Creator'  },
        { page: 'removebg',  href: '/app/remove.bg/',        icon: 'content_cut',             label: 'Remove Background' },
        { page: 'upscaler',   href: '/app/image.upscaler/',   icon: 'photo_size_select_large', label: 'Image Upscaler'    },
        { page: 'vectorize', href: '/app/image.vectorize/',  icon: 'polyline',                label: 'Image Vectorizer'  },
    ];

    // ── Sidebar ───────────────────────────────────────────────────────────────
    function buildSidebar(activePage) {
        const navItems = NAV_LINKS.map(({ page, href, icon, label }) => {
            const active = page === activePage;
            const cls = active
                ? 'flex items-center gap-3 px-2 py-2.5 rounded-xl text-lime bg-lime/10 transition-colors'
                : 'flex items-center gap-3 px-2 py-2.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors';
            return `<a href="${href}" class="${cls}">
                <span class="material-symbols-outlined text-xl min-w-[24px]">${icon}</span>
                <span class="opacity-0 group-hover:opacity-100 whitespace-nowrap transition-opacity duration-[180ms] text-xs font-medium font-label">${label}</span>
            </a>`;
        }).join('\n            ');

        return `<aside id="icon-rail" class="group fixed left-0 top-0 h-screen flex flex-col py-5 px-2 bg-[#111113] border-r border-outline-variant/10 z-50">
        <!-- Logo -->
        <div class="flex items-center gap-2 px-1.5 mb-6">
            <img src="/assets/brand_assets/logo.svg" alt="Xemy" class="h-7 w-auto min-w-[28px]" />
            <span class="opacity-0 group-hover:opacity-100 whitespace-nowrap transition-opacity duration-[180ms] text-base font-bold text-on-surface font-headline">Xemy</span>
        </div>

        <!-- Nav -->
        <nav class="flex flex-col gap-1 flex-1">
            ${navItems}
        </nav>

        <!-- Bottom -->
        <div class="flex flex-col gap-1">
            <a href="#" class="flex items-center gap-3 px-2 py-2.5 rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors">
                <span class="material-symbols-outlined text-xl min-w-[24px]">settings</span>
                <span class="opacity-0 group-hover:opacity-100 whitespace-nowrap transition-opacity duration-[180ms] text-xs font-medium font-label">Settings</span>
            </a>
            <div class="flex items-center gap-3 px-2 py-2 mt-1">
                <div class="w-8 h-8 min-w-[32px] rounded-full bg-surface-container-highest flex items-center justify-center border border-outline-variant/20 cursor-pointer">
                    <span id="user-initials" class="text-[10px] font-bold text-lime">?</span>
                </div>
                <span id="sidebar-user-name" class="opacity-0 group-hover:opacity-100 whitespace-nowrap transition-opacity duration-[180ms] text-xs font-medium text-on-surface truncate"></span>
            </div>
        </div>
    </aside>`;
    }

    // ── Header right strip ────────────────────────────────────────────────────
    function buildHeaderRight() {
        return `<div class="flex items-center gap-3">
            <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-lime/10 border border-lime/20">
                <span class="material-symbols-outlined text-lime text-sm">token</span>
                <span id="credit-balance" class="text-xs font-bold text-lime font-label">—</span>
            </div>
            <button class="text-on-surface-variant hover:text-on-surface transition-colors" title="Help">
                <span class="material-symbols-outlined text-lg">help_outline</span>
            </button>
            <button class="text-on-surface-variant hover:text-on-surface transition-colors" title="Notifications">
                <span class="material-symbols-outlined text-lg">notifications</span>
            </button>
            <button id="logout-btn" class="text-on-surface-variant hover:text-on-surface transition-colors" title="Logout">
                <span class="material-symbols-outlined text-lg">logout</span>
            </button>
        </div>`;
    }

    // ── Full header ──────────────────────────────────────────────────────────────
    function buildHeader(activePage) {
        const current = NAV_LINKS.find(l => l.page === activePage) || {};
        const icon = current.icon || 'apps';
        const label = current.label || 'Xemy';
        return `<header class="h-12 min-h-[48px] flex items-center justify-between px-5 bg-[#111113] border-b border-outline-variant/10 z-40">
            <div class="flex items-center gap-6">
                <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-lime text-lg">${icon}</span>
                    <span class="text-sm font-headline font-bold text-on-surface" id="user-name">${label}</span>
                    <span class="material-symbols-outlined text-on-surface-variant text-sm">expand_more</span>
                </div>
                <nav class="flex items-center gap-5 text-xs font-label">
                    <a class="text-on-surface-variant hover:text-on-surface transition-colors" href="#">Community</a>
                    <a class="text-on-surface-variant hover:text-on-surface transition-colors" href="#">My Assets</a>
                    <a class="text-on-surface-variant hover:text-on-surface transition-colors" href="#">API</a>
                    <a class="text-on-surface-variant hover:text-on-surface transition-colors" href="#">Learn</a>
                </nav>
            </div>
            ${buildHeaderRight()}
        </header>`;
    }

    // ── Inject sidebar + panel CSS (runs once) ──────────────────────────────
    function injectCSS() {
        if (document.getElementById('xemy-layout-css')) return;
        const style = document.createElement('style');
        style.id = 'xemy-layout-css';
        style.textContent = `
            #icon-rail { width: 56px; transition: width 0.25s cubic-bezier(0.4,0,0.2,1); overflow: hidden; }
            #icon-rail:hover { width: 200px; }
            #icon-rail:hover ~ #app-layout { margin-left: 200px; }

            /* Detached rounded panels */
            .xemy-panel {
                margin: 8px;
                border-radius: 16px;
                border: 1px solid rgba(72,71,74,0.15);
                overflow: hidden;
                transition: width 0.3s cubic-bezier(0.4,0,0.2,1),
                            min-width 0.3s cubic-bezier(0.4,0,0.2,1),
                            margin 0.3s cubic-bezier(0.4,0,0.2,1),
                            opacity 0.2s ease,
                            padding 0.3s cubic-bezier(0.4,0,0.2,1);
            }
            .xemy-panel.collapsed {
                width: 0 !important;
                min-width: 0 !important;
                margin-left: 0;
                margin-right: 0;
                padding: 0;
                opacity: 0;
                border: 0;
                pointer-events: none;
            }

            .xemy-panel-toggle {
                position: absolute;
                top: 50%;
                transform: translateY(-50%);
                z-index: 20;
                width: 20px;
                height: 40px;
                display: flex;
                align-items: center;
                justify-content: center;
                background: #19191c;
                border: 1px solid rgba(72,71,74,0.2);
                color: #adaaad;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            .xemy-panel-toggle:hover {
                background: #1f1f22;
                color: #b8f147;
                border-color: rgba(184,241,71,0.3);
            }
            .xemy-panel-toggle.left {
                right: -10px;
                border-radius: 0 8px 8px 0;
            }
            .xemy-panel-toggle.right {
                left: -10px;
                border-radius: 8px 0 0 8px;
            }
            .xemy-panel-toggle .material-symbols-outlined {
                font-size: 14px;
                line-height: 1;
            }
        `;
        document.head.appendChild(style);
    }

    // ── Panel toggle setup ──────────────────────────────────────────────────
    function setupPanels() {
        // Find content wrapper (the flex row containing panels)
        const contentRow = document.querySelector('#app-layout .flex.flex-1.overflow-hidden');
        if (!contentRow) return;

        const asides = contentRow.querySelectorAll(':scope > aside');
        asides.forEach((aside, i) => {
            const isLeft = i === 0;
            const isRight = i === asides.length - 1 && i > 0;
            if (!isLeft && !isRight) return;

            // Add panel class, remove old border styles
            aside.classList.add('xemy-panel');
            aside.classList.remove('border-r', 'border-l', 'border-outline-variant/10');

            // Create wrapper for toggle button positioning
            const wrapper = document.createElement('div');
            wrapper.className = 'relative flex flex-col';
            wrapper.style.transition = 'all 0.3s cubic-bezier(0.4,0,0.2,1)';
            aside.parentNode.insertBefore(wrapper, aside);
            wrapper.appendChild(aside);

            // Create toggle button
            const toggle = document.createElement('button');
            toggle.className = `xemy-panel-toggle ${isLeft ? 'left' : 'right'}`;
            toggle.innerHTML = `<span class="material-symbols-outlined">${isLeft ? 'chevron_left' : 'chevron_right'}</span>`;
            toggle.title = isLeft ? 'Toggle controls panel' : 'Toggle history panel';
            wrapper.appendChild(toggle);

            toggle.addEventListener('click', () => {
                const collapsed = aside.classList.toggle('collapsed');
                const icon = toggle.querySelector('.material-symbols-outlined');
                if (isLeft) {
                    icon.textContent = collapsed ? 'chevron_right' : 'chevron_left';
                } else {
                    icon.textContent = collapsed ? 'chevron_left' : 'chevron_right';
                }
            });
        });
    }

    // ── Mount ─────────────────────────────────────────────────────────────────
    function render() {
        injectCSS();

        const activePage = document.body.dataset.page || '';

        const sidebarMount = document.getElementById('sidebar-mount');
        if (sidebarMount) {
            const el = document.createElement('div');
            el.innerHTML = buildSidebar(activePage);
            sidebarMount.replaceWith(el.firstElementChild);
        }

        const headerMount = document.getElementById('header-mount');
        if (headerMount) {
            const el = document.createElement('div');
            el.innerHTML = buildHeader(activePage);
            headerMount.replaceWith(el.firstElementChild);
        }

        setupPanels();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', render);
    } else {
        render();
    }
})();
