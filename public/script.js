// Standalone Vanilla JS file - CSP Compliant

document.addEventListener('DOMContentLoaded', () => {
    // 1. Navbar Scroll Logic
    const navbar = document.getElementById('navbar');
    
    // Throttle scroll event for performance
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
        // Trigger point for the pop-out effect
        if (window.scrollY > 60) {
            navbar.classList.add('nav-scrolled');
            // Remove full-width classes just in case
            navbar.classList.remove('border-transparent');
        } else {
            navbar.classList.remove('nav-scrolled');
            navbar.classList.add('border-transparent');
        }
    }

    // Initialize state on load in case user refreshed halfway down the page
    handleNavbarScroll();
});