const form = document.getElementById("login-form");
const errorEl = document.getElementById("login-error");
const initial = window.__LOGIN__ || {};
const submitBtn = document.getElementById("submit-btn");
const submitText = document.getElementById("submit-text");
const submitSpinner = document.getElementById("submit-spinner");
const passwordInput = document.getElementById("password");
const passwordToggle = document.getElementById("password-toggle");
const usernameInput = document.getElementById("username");
const usernameWrapper = document.getElementById("username-wrapper");
const passwordWrapper = document.getElementById("password-wrapper");

// Password visibility toggle
passwordToggle?.addEventListener("click", () => {
  const isPassword = passwordInput.type === "password";
  passwordInput.type = isPassword ? "text" : "password";
  passwordToggle.setAttribute("aria-pressed", isPassword);
  passwordToggle.textContent = isPassword ? "🔒" : "👁";
});

// Track input values for visual feedback
function updateInputHasValue(input, wrapper) {
  if (input.value.length > 0) {
    wrapper.classList.add("has-value");
  } else {
    wrapper.classList.remove("has-value");
  }
}

usernameInput?.addEventListener("input", () =>
  updateInputHasValue(usernameInput, usernameWrapper)
);
passwordInput?.addEventListener("input", () =>
  updateInputHasValue(passwordInput, passwordWrapper)
);

// Initial check for username value
if (usernameInput?.value) {
  updateInputHasValue(usernameInput, usernameWrapper);
}

// Show initial error
if (initial.error) {
  const errorTextEl = document.getElementById("error-text");
  errorEl.classList.remove("hidden");
  if (errorTextEl) {
    errorTextEl.textContent = initial.error;
  } else {
    errorEl.textContent = initial.error;
  }
  errorEl.setAttribute("role", "alert");
  form?.classList.add("error-shake");
  setTimeout(() => form?.classList.remove("error-shake"), 500);

  // Focus first input for accessibility
  usernameInput?.focus();
}

// Form validation helper
function validateForm() {
  let isValid = true;

  // Username validation
  if (usernameInput.value.trim()) {
    usernameInput.setAttribute("aria-invalid", "false");
  } else {
    usernameInput.setAttribute("aria-invalid", "true");
    isValid = false;
  }

  // Password validation
  if (passwordInput.value) {
    passwordInput.setAttribute("aria-invalid", "false");
  } else {
    passwordInput.setAttribute("aria-invalid", "true");
    isValid = false;
  }

  return isValid;
}

// Loading state helper
function setLoading(loading) {
  if (loading) {
    submitBtn.classList.add("btn-loading");
    submitBtn.disabled = true;
    submitText.textContent = "Authenticating...";
    submitSpinner.classList.remove("hidden");
    usernameInput.disabled = true;
    passwordInput.disabled = true;
    passwordToggle.disabled = true;
  } else {
    submitBtn.classList.remove("btn-loading");
    submitBtn.disabled = false;
    submitText.textContent = "▶ Access System";
    submitSpinner.classList.add("hidden");
    usernameInput.disabled = false;
    passwordInput.disabled = false;
    passwordToggle.disabled = false;
  }
}

// Form submission
form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.classList.add("hidden");

  // Validate form
  if (!validateForm()) {
    const errorMessage = usernameInput.value.trim()
      ? "Password is required."
      : "Username is required.";

    const errorTextEl = document.getElementById("error-text");
    errorEl.classList.remove("hidden");
    if (errorTextEl) {
      errorTextEl.textContent = errorMessage;
    } else {
      errorEl.textContent = errorMessage;
    }
    errorEl.setAttribute("role", "alert");
    form?.classList.add("error-shake");
    setTimeout(() => form?.classList.remove("error-shake"), 500);

    // Focus first invalid input
    if (usernameInput.value.trim()) {
      passwordInput.focus();
    } else {
      usernameInput.focus();
    }
    return;
  }

  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();

  // Set loading state
  setLoading(true);

  try {
    const res = await fetch("/api/auth/sign-in/username", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username, password }),
    });

    if (res.ok) {
      // Success animation
      submitBtn.classList.add("success-pulse");
      submitText.textContent = "✓ Access Granted";

      // Delay redirect slightly for animation
      setTimeout(() => {
        window.location.href = "/";
      }, 600);
      return;
    }

    let message = "Invalid username or password.";
    try {
      const body = await res.json();
      if (body?.message) {
        message = body.message;
      } else if (body?.error?.message) {
        message = body.error.message;
      }
    } catch (_err) {
      // ignore parse errors
    }

    const errorTextEl = document.getElementById("error-text");
    errorEl.classList.remove("hidden");
    if (errorTextEl) {
      errorTextEl.textContent = message;
    } else {
      errorEl.textContent = message;
    }
    errorEl.setAttribute("role", "alert");
    form?.classList.add("error-shake");
    setTimeout(() => form?.classList.remove("error-shake"), 500);
  } catch (_err) {
    const errorTextEl = document.getElementById("error-text");
    errorEl.classList.remove("hidden");
    if (errorTextEl) {
      errorTextEl.textContent = "Network error. Please try again.";
    } else {
      errorEl.textContent = "Network error. Please try again.";
    }
    errorEl.setAttribute("role", "alert");
    form?.classList.add("error-shake");
    setTimeout(() => form?.classList.remove("error-shake"), 500);
  } finally {
    setLoading(false);
  }
});

// Clear error on input
usernameInput?.addEventListener("input", () => {
  if (errorEl.getAttribute("role") === "alert") {
    errorEl.classList.add("hidden");
    errorEl.removeAttribute("role");
  }
});

passwordInput?.addEventListener("input", () => {
  if (errorEl.getAttribute("role") === "alert") {
    errorEl.classList.add("hidden");
    errorEl.removeAttribute("role");
  }
});

// Enter key submits form (standard behavior already works)
// But we can prevent accidental double submissions
let isSubmitting = false;
form?.addEventListener("submit", (e) => {
  if (isSubmitting) {
    e.preventDefault();
    return;
  }
  isSubmitting = true;
  setTimeout(() => {
    isSubmitting = false;
  }, 2000);
});
