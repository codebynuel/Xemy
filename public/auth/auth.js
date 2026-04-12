document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
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

    let isLoginView = true;

    // Toggle Login / Sign Up View
    toggleViewBtn.addEventListener('click', (e) => {
        e.preventDefault();
        isLoginView = !isLoginView;

        if (isLoginView) {
            // Switch to Login
            formTitle.textContent = 'Welcome Back';
            formSubtitle.textContent = 'Sign in to access your workspaces.';
            nameField.classList.add('hidden');
            forgotPasswordLink.classList.remove('hidden');
            submitBtn.textContent = 'Sign In';
            toggleText.textContent = "Don't have an account?";
            toggleViewBtn.textContent = 'Sign up';
        } else {
            // Switch to Sign Up
            formTitle.textContent = 'Create Account';
            formSubtitle.textContent = 'Start generating 3D models in seconds.';
            nameField.classList.remove('hidden');
            forgotPasswordLink.classList.add('hidden'); // Hide forgot password on signup
            submitBtn.textContent = 'Create Account';
            toggleText.textContent = "Already have an account?";
            toggleViewBtn.textContent = 'Sign in';
        }
    });

    // Toggle Password Visibility
    togglePasswordBtn.addEventListener('click', () => {
        const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', type);
        
        // Optional: Swap SVG icon depending on state (eye vs eye-slash)
        // For simplicity, we keep the eye icon, but you can swap innerHTML here
    });

    // Form Submission (Mock)
    const authForm = document.getElementById('auth-form');
    authForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const endpoint = isLoginView ? '/api/auth/login' : '/api/auth/register';
        const payload = {
            email: emailInput.value,
            password: passwordInput.value
        };
        
        if (!isLoginView) {
            payload.name = nameInput.value;
        }
        
        authMessage.classList.add('hidden');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Processing...';

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
            
            authMessage.textContent = data.message || 'Success!';
            authMessage.className = 'text-sm text-center text-green-400 mt-2 block';
            
            localStorage.setItem('token', data.token);
            setTimeout(() => window.location.href = '../index.html', 1000); // redirect on success
            
        } catch (error) {
            authMessage.textContent = error.message;
            authMessage.className = 'text-sm text-center text-red-400 mt-2 block';
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = isLoginView ? 'Sign In' : 'Create Account';
        }
    });
});