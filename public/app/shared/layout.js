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

    // ── Inject sidebar CSS (runs once) ────────────────────────────────────────
    function injectCSS() {
        if (document.getElementById('xemy-layout-css')) return;
        const style = document.createElement('style');
        style.id = 'xemy-layout-css';
        style.textContent = [
            '#icon-rail { width: 56px; transition: width 0.25s cubic-bezier(0.4,0,0.2,1); overflow: hidden; }',
            '#icon-rail:hover { width: 200px; }',
            '#icon-rail:hover ~ #app-layout { margin-left: 200px; }',
        ].join('\n');
        document.head.appendChild(style);
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
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', render);
    } else {
        render();
    }
})();
