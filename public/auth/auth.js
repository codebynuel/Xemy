document.addEventListener('DOMContentLoaded', () => {
    const formTitle = document.getElementById('form-title');
    const formSubtitle = document.getElementById('form-subtitle');
    const nameField = document.getElementById('name-field');
    const forgotPasswordLink = document.getElementById('forgot-password');
    const submitBtn = document.getElementById('submit-btn');
    const toggleText = document.getElementById('toggle-text');
    const toggleViewBtn = document.getElementById('toggle-view-btn');
    const nameInput = document.getElementById('name-input');
    const emailInput = document.getElementById('email-input');
    const passwordInput = document.getElementById('password-input');
    const togglePasswordBtn = document.getElementById('toggle-password');
    const authMessage = document.getElementById('auth-message');
    const authForm = document.getElementById('auth-form');

    let isLoginView = true;

    // Toggle Login / Sign Up View
    toggleViewBtn.addEventListener('click', (e) => {
        e.preventDefault();
        isLoginView = !isLoginView;

        if (isLoginView) {
            formTitle.textContent = 'Welcome Back';
            formSubtitle.textContent = 'Enter your credentials to enter the forge.';
            nameField.classList.add('hidden');
            forgotPasswordLink.classList.remove('hidden');
            submitBtn.textContent = 'Sign In';
            toggleText.textContent = "New to Xemy?";
            toggleViewBtn.textContent = 'Start Forging';
        } else {
            formTitle.textContent = 'Create Account';
            formSubtitle.textContent = 'Start generating 3D models in seconds.';
            nameField.classList.remove('hidden');
            forgotPasswordLink.classList.add('hidden');
            submitBtn.textContent = 'Create Account';
            toggleText.textContent = "Already have an account?";
            toggleViewBtn.textContent = 'Sign in';
        }

        // Clear message on view switch
        hideMessage();
    });

    // Toggle Password Visibility
    togglePasswordBtn.addEventListener('click', () => {
        const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', type);
        const icon = togglePasswordBtn.querySelector('.material-symbols-outlined');
        if (icon) icon.textContent = type === 'password' ? 'visibility' : 'visibility_off';
    });

    // Form Submission
    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const endpoint = isLoginView ? '/api/auth/login' : '/api/auth/register';
        const payload = { email: emailInput.value, password: passwordInput.value };
        if (!isLoginView) payload.name = nameInput.value;

        hideMessage();
        setLoading(true);

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Authentication failed');
            }

            // Cookie is set server-side — no localStorage needed
            showMessage(data.message || 'Success!', 'success');
            setTimeout(() => { window.location.href = '/'; }, 900);

        } catch (error) {
            showMessage(error.message, 'error');
            shakeForm();
        } finally {
            setLoading(false);
        }
    });

    // ---- Helpers ----

    function setLoading(loading) {
        submitBtn.disabled = loading;
        if (loading) {
            submitBtn.innerHTML = `
                <svg class="animate-spin inline-block w-5 h-5 mr-2 -mt-0.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
                </svg>
                Processing…`;
        } else {
            submitBtn.textContent = isLoginView ? 'Sign In' : 'Create Account';
        }
    }

    function showMessage(text, type) {
        const isError = type === 'error';
        authMessage.className = `flex items-center gap-2 text-sm rounded-xl px-4 py-3 mt-1 ${
            isError
                ? 'bg-error/10 text-error border border-error/20'
                : 'bg-green-500/10 text-green-400 border border-green-500/20'
        }`;
        authMessage.innerHTML = `
            <span class="material-symbols-outlined text-base">${isError ? 'error' : 'check_circle'}</span>
            <span>${text}</span>`;
        authMessage.classList.remove('hidden');
    }

    function hideMessage() {
        authMessage.classList.add('hidden');
        authMessage.innerHTML = '';
    }

    function shakeForm() {
        authForm.classList.add('shake');
        authForm.addEventListener('animationend', () => authForm.classList.remove('shake'), { once: true });
    }
});
