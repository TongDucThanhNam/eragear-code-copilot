export const LOGIN_STYLES = `
  .font-display { font-family: 'Playfair Display', serif; }
  .font-body { font-family: 'Lora', serif; }
  .font-sans { font-family: 'Inter', sans-serif; }
  .font-mono { font-family: 'JetBrains Mono', monospace; }
  .sharp-corners { border-radius: 0px !important; }

  .newsprint-dots {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4' viewBox='0 0 4 4'%3E%3Cpath fill='%23111111' fill-opacity='0.05' d='M1 3h1v1H1V3zm2-2h1v1H3V1z'%3E%3C/path%3E%3C/svg%3E");
  }

  .newsprint-lines {
    position: relative;
  }
  .newsprint-lines::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(0deg, transparent 98%, rgba(0,0,0,0.03) 100%),
      linear-gradient(90deg, transparent 98%, rgba(0,0,0,0.03) 100%);
    background-size: 24px 24px;
    pointer-events: none;
  }

  .halftone {
    background-image: radial-gradient(#111111 1px, transparent 1px);
    background-size: 6px 6px;
  }

  .drop-cap {
    float: left;
    font-size: 5rem;
    line-height: 0.65;
    font-weight: 900;
    padding-right: 0.6rem;
    padding-top: 0.3rem;
    margin-right: 0.3rem;
    font-family: 'Playfair Display', serif;
    color: #111111;
  }

  .drop-cap-small {
    float: left;
    font-size: 2.75rem;
    line-height: 0.7;
    font-weight: 700;
    padding-right: 0.5rem;
    padding-top: 0.25rem;
    font-family: 'Playfair Display', serif;
  }

  .input-underline {
    background: transparent;
    border: none;
    border-bottom: 2px solid #111111;
    padding: 0.875rem 0 0.75rem;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.875rem;
    border-radius: 0;
    transition: all 0.2s ease;
  }
  .input-underline::placeholder {
    color: #999999;
  }
  .input-underline:focus {
    outline: none;
    background-color: #F0F0EB;
    border-bottom-color: #CC0000;
  }
  .input-underline:focus-visible {
    outline: 2px solid #CC0000;
    outline-offset: 2px;
  }

  .field-group .input-wrapper {
    position: relative;
  }
  .field-group .input-wrapper::after {
    content: '';
    position: absolute;
    left: 0;
    bottom: -2px;
    height: 2px;
    width: 0%;
    background: #CC0000;
    transition: width 0.3s ease;
  }
  .field-group:focus-within .input-wrapper::after {
    width: 100%;
  }

  .input-wrapper.has-value::after {
    width: 100%;
    background: #111111;
    opacity: 0.3;
  }

  .section-label {
    font-family: 'JetBrains Mono', monospace;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    font-size: 0.7rem;
  }

  .ornament-cross {
    position: relative;
    display: inline-block;
    width: 12px;
    height: 12px;
  }
  .ornament-cross::before,
  .ornament-cross::after {
    content: '';
    position: absolute;
    background: #111111;
  }
  .ornament-cross::before {
    width: 12px;
    height: 1px;
    top: 5px;
    left: 0;
  }
  .ornament-cross::after {
    width: 1px;
    height: 12px;
    top: 0;
    left: 5px;
  }

  .ornament-diamond {
    width: 6px;
    height: 6px;
    background: #CC0000;
    transform: rotate(45deg);
    display: inline-block;
  }

  .ornament-star {
    font-size: 8px;
    line-height: 1;
  }

  .pull-quote {
    font-style: italic;
    position: relative;
  }
  .pull-quote::before {
    content: '“';
    position: absolute;
    left: -12px;
    top: -8px;
    font-size: 2rem;
    color: #CC0000;
    font-family: 'Playfair Display', serif;
  }
  .pull-quote::after {
    content: '”';
    position: absolute;
    right: -8px;
    bottom: -16px;
    font-size: 2rem;
    color: #CC0000;
    font-family: 'Playfair Display', serif;
  }

  .section-divider {
    border-top: 1px solid #111111;
    border-bottom: 1px solid #111111;
    padding: 0.5rem 0;
    margin: 1rem 0;
  }

  .deck-text {
    font-family: 'Lora', serif;
    font-size: 1.1rem;
    font-style: italic;
    line-height: 1.4;
    color: #333333;
  }

  .byline {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: #666666;
  }

  .field-number {
    font-family: 'Playfair Display', serif;
    font-size: 1.5rem;
    font-weight: 700;
    color: #CC0000;
    line-height: 1;
  }

  .input-wrapper:focus-within .field-number {
    color: #111111;
  }

  .error-shake {
    animation: shake 0.5s ease-in-out;
  }
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-4px); }
    40% { transform: translateX(4px); }
    60% { transform: translateX(-4px); }
    80% { transform: translateX(4px); }
  }

  .btn-loading {
    position: relative;
    overflow: hidden;
  }
  .btn-loading::after {
    content: '';
    position: absolute;
    top: 0;
    left: -100%;
    width: 100%;
    height: 100%;
    background: linear-gradient(
      90deg,
      transparent,
      rgba(255, 255, 255, 0.1),
      transparent
    );
    transition: left 0.5s ease;
  }
  button:not(.password-toggle):hover::after {
    left: 100%;
  }

  /* Subtle pulse for the decorative dots */
  .pulse-dot {
    animation: subtlePulse 2s ease-in-out infinite;
  }
  @keyframes subtlePulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5;
    }
  }

  /* Focus ring improvement for password toggle */
  .password-toggle:focus-visible {
    outline: 2px solid #CC0000;
    outline-offset: 2px;
    border-radius: 4px;
  }
`;

export const LOGIN_SCRIPT = `
  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');
  const initial = window.__LOGIN__ || {};
  const submitBtn = document.getElementById('submit-btn');
  const submitText = document.getElementById('submit-text');
  const submitSpinner = document.getElementById('submit-spinner');
  const passwordInput = document.getElementById('password');
  const passwordToggle = document.getElementById('password-toggle');
  const usernameInput = document.getElementById('username');
  const usernameWrapper = document.getElementById('username-wrapper');
  const passwordWrapper = document.getElementById('password-wrapper');

  // Password visibility toggle
  passwordToggle?.addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    passwordToggle.setAttribute('aria-pressed', isPassword);
    passwordToggle.textContent = isPassword ? '🔒' : '👁';
  });

  // Track input values for visual feedback
  function updateInputHasValue(input, wrapper) {
    if (input.value.length > 0) {
      wrapper.classList.add('has-value');
    } else {
      wrapper.classList.remove('has-value');
    }
  }

  usernameInput?.addEventListener('input', () => updateInputHasValue(usernameInput, usernameWrapper));
  passwordInput?.addEventListener('input', () => updateInputHasValue(passwordInput, passwordWrapper));

  // Initial check for username value
  if (usernameInput?.value) {
    updateInputHasValue(usernameInput, usernameWrapper);
  }

  // Show initial error
  if (initial.error) {
    const errorTextEl = document.getElementById('error-text');
    errorEl.classList.remove('hidden');
    if (errorTextEl) {
      errorTextEl.textContent = initial.error;
    } else {
      errorEl.textContent = initial.error;
    }
    errorEl.setAttribute('role', 'alert');
    form?.classList.add('error-shake');
    setTimeout(() => form?.classList.remove('error-shake'), 500);

    // Focus first input for accessibility
    usernameInput?.focus();
  }

  // Form validation helper
  function validateForm() {
    let isValid = true;

    // Username validation
    if (!usernameInput.value.trim()) {
      usernameInput.setAttribute('aria-invalid', 'true');
      isValid = false;
    } else {
      usernameInput.setAttribute('aria-invalid', 'false');
    }

    // Password validation
    if (!passwordInput.value) {
      passwordInput.setAttribute('aria-invalid', 'true');
      isValid = false;
    } else {
      passwordInput.setAttribute('aria-invalid', 'false');
    }

    return isValid;
  }

  // Loading state helper
  function setLoading(loading) {
    if (loading) {
      submitBtn.classList.add('btn-loading');
      submitBtn.disabled = true;
      submitText.textContent = 'Authenticating...';
      submitSpinner.classList.remove('hidden');
      usernameInput.disabled = true;
      passwordInput.disabled = true;
      passwordToggle.disabled = true;
    } else {
      submitBtn.classList.remove('btn-loading');
      submitBtn.disabled = false;
      submitText.textContent = '▶ Access System';
      submitSpinner.classList.add('hidden');
      usernameInput.disabled = false;
      passwordInput.disabled = false;
      passwordToggle.disabled = false;
    }
  }

  // Form submission
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.classList.add('hidden');

    // Validate form
    if (!validateForm()) {
      const errorMessage = !usernameInput.value.trim()
        ? 'Username is required.'
        : 'Password is required.';

      const errorTextEl = document.getElementById('error-text');
      errorEl.classList.remove('hidden');
      if (errorTextEl) {
        errorTextEl.textContent = errorMessage;
      } else {
        errorEl.textContent = errorMessage;
      }
      errorEl.setAttribute('role', 'alert');
      form?.classList.add('error-shake');
      setTimeout(() => form?.classList.remove('error-shake'), 500);

      // Focus first invalid input
      if (!usernameInput.value.trim()) {
        usernameInput.focus();
      } else {
        passwordInput.focus();
      }
      return;
    }

    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    // Set loading state
    setLoading(true);

    try {
      const res = await fetch('/api/auth/sign-in/username', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        // Success animation
        submitBtn.classList.add('success-pulse');
        submitText.textContent = '✓ Access Granted';

        // Delay redirect slightly for animation
        setTimeout(() => {
          window.location.href = '/';
        }, 600);
        return;
      }

      let message = 'Invalid username or password.';
      try {
        const body = await res.json();
        if (body?.message) {
          message = body.message;
        } else if (body?.error?.message) {
          message = body.error.message;
        }
      } catch (err) {
        // ignore parse errors
      }

      const errorTextEl = document.getElementById('error-text');
      errorEl.classList.remove('hidden');
      if (errorTextEl) {
        errorTextEl.textContent = message;
      } else {
        errorEl.textContent = message;
      }
      errorEl.setAttribute('role', 'alert');
      form?.classList.add('error-shake');
      setTimeout(() => form?.classList.remove('error-shake'), 500);

    } catch (err) {
      const errorTextEl = document.getElementById('error-text');
      errorEl.classList.remove('hidden');
      if (errorTextEl) {
        errorTextEl.textContent = 'Network error. Please try again.';
      } else {
        errorEl.textContent = 'Network error. Please try again.';
      }
      errorEl.setAttribute('role', 'alert');
      form?.classList.add('error-shake');
      setTimeout(() => form?.classList.remove('error-shake'), 500);
    } finally {
      setLoading(false);
    }
  });

  // Clear error on input
  usernameInput?.addEventListener('input', () => {
    if (errorEl.getAttribute('role') === 'alert') {
      errorEl.classList.add('hidden');
      errorEl.removeAttribute('role');
    }
  });

  passwordInput?.addEventListener('input', () => {
    if (errorEl.getAttribute('role') === 'alert') {
      errorEl.classList.add('hidden');
      errorEl.removeAttribute('role');
    }
  });

  // Enter key submits form (standard behavior already works)
  // But we can prevent accidental double submissions
  let isSubmitting = false;
  form?.addEventListener('submit', (e) => {
    if (isSubmitting) {
      e.preventDefault();
      return;
    }
    isSubmitting = true;
    setTimeout(() => {
      isSubmitting = false;
    }, 2000);
  });
`;
