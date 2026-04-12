// Standalone Vanilla JS file - CSP Compliant

document.addEventListener('DOMContentLoaded', () => {
    verifyAuthState();
    initializeNavbarScroll();
    initializeMobileMenu();
    initializeScrollAnimations();
});

async function verifyAuthState() {
    try {
        const response = await fetch('/api/auth/verify');
        const data = await response.json();
        if (data.authenticated) {
            updateHeaderForAuthenticated(data.user);
        } else {
            updateHeaderForUnauthenticated();
        }
    } catch (error) {
        console.error('Auth verification failed:', error);
        updateHeaderForUnauthenticated();
    }
}

function updateHeaderForAuthenticated(user) {
    const signInBtn = document.getElementById('sign-in-btn');
    const getStartedBtn = document.getElementById('get-started-btn');
    const mobileSignInBtn = document.getElementById('mobile-sign-in-btn');
    const displayName = user.name || user.email;

    signInBtn.textContent = displayName;
    signInBtn.classList.add('text-primary');
    signInBtn.onclick = () => { window.location.href = '/app/workspace.html'; };

    if (mobileSignInBtn) {
        mobileSignInBtn.textContent = displayName;
        mobileSignInBtn.onclick = () => { window.location.href = '/app/workspace.html'; };
    }

    getStartedBtn.textContent = 'Logout';
    getStartedBtn.classList.remove('bg-primary', 'text-on-primary-fixed');
    getStartedBtn.classList.add('border', 'border-outline-variant', 'text-on-surface');
    getStartedBtn.style.background = 'transparent';
    getStartedBtn.onclick = () => logout();
}

function updateHeaderForUnauthenticated() {
    const signInBtn = document.getElementById('sign-in-btn');
    const getStartedBtn = document.getElementById('get-started-btn');
    const mobileSignInBtn = document.getElementById('mobile-sign-in-btn');

    signInBtn.textContent = 'Sign In';
    signInBtn.classList.remove('text-primary');
    signInBtn.onclick = () => { window.location.href = '/auth/index.html'; };

    if (mobileSignInBtn) {
        mobileSignInBtn.textContent = 'Sign In';
        mobileSignInBtn.onclick = () => { window.location.href = '/auth/index.html'; };
    }

    getStartedBtn.textContent = 'Get Started';
    getStartedBtn.classList.add('bg-primary', 'text-on-primary-fixed');
    getStartedBtn.classList.remove('border', 'border-outline-variant', 'text-on-surface');
    getStartedBtn.style.background = '';
    getStartedBtn.onclick = () => { window.location.href = '/auth/index.html'; };
}

async function logout() {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
        updateHeaderForUnauthenticated();
        window.location.href = '/';
    } catch (error) {
        console.error('Logout failed:', error);
    }
}

function initializeNavbarScroll() {
    const navbar = document.getElementById('navbar');
    let isScrolling = false;

    window.addEventListener('scroll', () => {
        if (!isScrolling) {
            window.requestAnimationFrame(() => {
                handleNavbarScroll();
                isScrolling = false;
            });
            isScrolling = true;
        }
    });

    function handleNavbarScroll() {
        if (window.scrollY > 60) {
            navbar.classList.add('nav-scrolled');
        } else {
            navbar.classList.remove('nav-scrolled');
        }
    }

    handleNavbarScroll();
}

function initializeMobileMenu() {
    const btn = document.getElementById('mobile-menu-btn');
    const menu = document.getElementById('mobile-menu');
    if (!btn || !menu) return;

    const hbTop = document.getElementById('hb-top');
    const hbMid = document.getElementById('hb-mid');
    const hbBot = document.getElementById('hb-bot');
    let open = false;

    function openMenu() {
        open = true;
        menu.classList.add('open');
        if (hbTop) hbTop.style.transform = 'rotate(45deg) translate(4px, 4px)';
        if (hbMid) { hbMid.style.opacity = '0'; hbMid.style.transform = 'scaleX(0)'; }
        if (hbBot) hbBot.style.transform = 'rotate(-45deg) translate(4px, -4px)';
    }

    function closeMenu() {
        open = false;
        menu.classList.remove('open');
        if (hbTop) hbTop.style.transform = '';
        if (hbMid) { hbMid.style.opacity = ''; hbMid.style.transform = ''; }
        if (hbBot) hbBot.style.transform = '';
    }

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        open ? closeMenu() : openMenu();
    });

    menu.querySelectorAll('.mobile-nav-link').forEach(link => {
        link.addEventListener('click', closeMenu);
    });

    document.addEventListener('click', (e) => {
        if (open && !menu.contains(e.target) && e.target !== btn) {
            closeMenu();
        }
    });
}

function initializeScrollAnimations() {
    const elements = document.querySelectorAll('[data-animate]');
    if (!elements.length) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.12 });

    elements.forEach(el => observer.observe(el));
}
