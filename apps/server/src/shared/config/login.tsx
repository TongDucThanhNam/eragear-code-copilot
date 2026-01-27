interface LoginPageProps {
  error?: string;
  username?: string;
}

export function LoginPage({ error, username }: LoginPageProps) {
  const loginJson = JSON.stringify({ error, username }).replace(
    /</g,
    "\\u003c"
  );

  const currentDate = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta
          content="width=device-width, initial-scale=1, viewport-fit=cover"
          name="viewport"
        />
        <title>Eragear Server Login</title>

        {/* Tailwind CSS v4 */}
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4" />

        {/* Fonts */}
        <link href="https://fonts.googleapis.com" rel="preconnect" />
        <link
          crossOrigin="anonymous"
          href="https://fonts.gstatic.com"
          rel="preconnect"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Lora:ital,wght@0,400;0,600;1,400&family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400&display=swap"
          rel="stylesheet"
        />

        {/* Newsprint Styles */}
        <link href="/ui/styles.css" rel="stylesheet" />

        <style>
          {`
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
            .input-underline:disabled {
              opacity: 0.5;
              cursor: not-allowed;
            }
            .input-underline:disabled::placeholder {
              opacity: 0.5;
            }

            /* Keyboard hint styling */
            kbd {
              display: inline-block;
              padding: 0.125rem 0.5rem;
              font-family: 'JetBrains Mono', monospace;
              font-size: 0.7rem;
              font-weight: 500;
              color: #F9F9F7;
              background-color: #111111;
              border: 1px solid #111111;
              border-radius: 2px;
              box-shadow: 1px 1px 0px 0px rgba(0, 0, 0, 0.2);
              white-space: nowrap;
            }

            /* Password toggle button */
            .password-toggle {
              position: absolute;
              right: 0;
              top: 50%;
              transform: translateY(-50%);
              background: none;
              border: none;
              cursor: pointer;
              padding: 0.5rem;
              color: #888888;
              transition: color 0.2s ease;
              font-size: 1.25rem;
            }
            .password-toggle:hover {
              color: #CC0000;
            }
            .password-toggle:focus-visible {
              outline: 2px solid #CC0000;
              outline-offset: 2px;
              border-radius: 4px;
            }

            /* Input wrapper */
            .input-wrapper {
              position: relative;
            }

            /* Loading spinner */
            .spinner {
              width: 18px;
              height: 18px;
              border: 2px solid #F9F9F7;
              border-top-color: transparent;
              border-radius: 50%;
              animation: spin 0.8s linear infinite;
            }
            @keyframes spin {
              to { transform: rotate(360deg); }
            }

            /* Error shake animation */
            .error-shake {
              animation: shake 0.5s ease-in-out;
            }
            @keyframes shake {
              0%, 100% { transform: translateX(0); }
              20%, 60% { transform: translateX(-8px); }
              40%, 80% { transform: translateX(8px); }
            }

            /* Button loading state */
            .btn-loading {
              opacity: 0.7;
              cursor: wait;
            }
            .btn-loading:hover {
              transform: none !important;
            }

            /* Field group animations */
            .field-group {
              opacity: 0;
              animation: fadeSlideUp 0.5s ease forwards;
            }
            .field-group:nth-child(1) { animation-delay: 0.1s; }
            .field-group:nth-child(2) { animation-delay: 0.2s; }
            @keyframes fadeSlideUp {
              from {
                opacity: 0;
                transform: translateY(10px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }

            /* Success state animation */
            .success-pulse {
              animation: successPulse 0.6s ease;
            }
            @keyframes successPulse {
              0%, 100% { box-shadow: 3px 3px 0px 0px #CC0000; }
              50% { box-shadow: 0 0 20px 5px rgba(204, 0, 0, 0.4); }
            }

            /* Input filled state indicator */
            .input-wrapper.has-value::after {
              content: '✓';
              position: absolute;
              right: 2.5rem;
              top: 50%;
              transform: translateY(-50%);
              color: #CC0000;
              font-size: 0.875rem;
              opacity: 0;
              animation: checkFade 0.3s ease forwards;
            }
            @keyframes checkFade {
              to { opacity: 1; }
            }

            /* Focus ring utility */
            .focus-ring:focus {
              outline: 2px solid #CC0000;
              outline-offset: 2px;
            }

            /* Skip link for accessibility */
            .skip-link {
              position: absolute;
              top: -100%;
              left: 0;
              background: #111111;
              color: #F9F9F7;
              padding: 1rem;
              z-index: 9999;
              transition: top 0.2s;
            }
            .skip-link:focus {
              top: 0;
            }

            .ornament-fleur {
              display: inline-block;
              width: 14px;
              height: 14px;
              background: linear-gradient(135deg, transparent 42%, #111111 42%, #111111 58%, transparent 58%),
                          linear-gradient(45deg, transparent 42%, #111111 42%, #111111 58%, transparent 58%);
              transform: rotate(45deg);
              margin: 0 10px;
            }

            .ornament-diamond {
              display: inline-block;
              width: 8px;
              height: 8px;
              border: 2px solid #111111;
              transform: rotate(45deg);
              margin: 0 6px;
            }

            .ornament-star {
              display: inline-block;
              font-size: 10px;
              margin: 0 8px;
              color: #111111;
            }

            .ornament-cross {
              display: inline-block;
              width: 10px;
              height: 10px;
              position: relative;
              margin: 0 10px;
            }
            .ornament-cross::before,
            .ornament-cross::after {
              content: '';
              position: absolute;
              background: #111111;
            }
            .ornament-cross::before {
              width: 10px;
              height: 2px;
              top: 4px;
              left: 0;
            }
            .ornament-cross::after {
              width: 2px;
              height: 10px;
              top: 0;
              left: 4px;
            }

            .justified {
              text-align: justify;
            }
            .justified::after {
              content: '';
              display: inline-block;
              width: 100%;
            }

            .pull-quote {
              border-left: 4px solid #CC0000;
              padding-left: 1.25rem;
              margin: 1.25rem 0;
              font-style: italic;
              font-size: 1.125rem;
              line-height: 1.5;
              font-family: 'Playfair Display', serif;
              color: #111111;
            }

            .column-rule-left {
              border-left: 1px solid rgba(0,0,0,0.08);
            }

            .column-rule-right {
              border-right: 1px solid rgba(0,0,0,0.08);
            }

            .deck-text {
              font-size: 0.95rem;
              font-style: italic;
              color: #525252;
              margin-top: 0.5rem;
              line-height: 1.5;
            }

            .byline {
              font-family: 'JetBrains Mono', monospace;
              font-size: 0.65rem;
              color: #888888;
              text-transform: uppercase;
              letter-spacing: 0.2em;
              margin-top: 0.5rem;
            }

            .min-h-screen {
              min-height: 100vh;
            }
            
            .flex-grow {
              flex-grow: 1;
            }

            .corner-ornament {
              position: absolute;
              width: 16px;
              height: 16px;
              border: 2px solid #111111;
            }
            .corner-ornament-tl { top: 3px; left: 3px; border-right: none; border-bottom: none; }
            .corner-ornament-tr { top: 3px; right: 3px; border-left: none; border-bottom: none; }
            .corner-ornament-bl { bottom: 3px; left: 3px; border-right: none; border-top: none; }
            .corner-ornament-br { bottom: 3px; right: 3px; border-left: none; border-top: none; }

            .section-label {
              font-family: 'JetBrains Mono', monospace;
              font-size: 0.7rem;
              letter-spacing: 0.15em;
            }

            .field-number {
              font-family: 'JetBrains Mono', monospace;
              font-size: 0.8rem;
              color: #CC0000;
              font-weight: 500;
            }

            /* Form heading animation */
            .form-heading-animate {
              animation: slideInLeft 0.6s ease-out;
            }
            @keyframes slideInLeft {
              from {
                opacity: 0;
                transform: translateX(-20px);
              }
              to {
                opacity: 1;
                transform: translateX(0);
              }
            }

            /* Button hover effect enhancement */
            button:not(.password-toggle) {
              position: relative;
              overflow: hidden;
            }
            button:not(.password-toggle)::after {
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
          `}
        </style>

        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Data is server-rendered
          dangerouslySetInnerHTML={{
            __html: `window.__LOGIN__ = ${loginJson};`,
          }}
        />
      </head>
      <body class="flex min-h-screen flex-col bg-[#F9F9F7] font-body text-[#111111] antialiased">
        {/* Skip Link for Accessibility */}
        <a class="skip-link font-mono text-sm" href="#login-form">
          Skip to login form
        </a>
        {/* Dot Grid Background */}
        <div class="newsprint-dots pointer-events-none fixed inset-0 z-0" />

        {/* Newspaper Front Page Layout */}
        <main class="relative z-10 mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-3 py-6 sm:px-4 sm:py-8 md:px-6 md:py-10 lg:px-8">
          {/* Top Masthead - Newspaper Header */}
          <header class="relative mb-6 border-[#111111] border-b-4 pb-4">
            {/* Corner Ornaments */}
            {/* <div class="corner-ornament corner-ornament-tl" /> */}
            {/* <div class="corner-ornament corner-ornament-tr" /> */}

            {/* Top Bar: Edition Info */}
            <div class="mb-3 flex flex-wrap items-center justify-between border-[#111111] border-b pb-2">
              <div class="flex items-center gap-3 font-mono text-[#666666] text-[9px] uppercase tracking-wider">
                <span class="bg-[#111111] px-2 py-0.5 text-[#F9F9F7]">
                  Vol. 1.0
                </span>
                <span class="hidden text-[#999999] sm:inline">|</span>
                <span class="hidden font-semibold text-[#666666] sm:inline">
                  Server Edition
                </span>
                <span class="hidden text-[#999999] sm:inline">|</span>
                <span class="text-[#666666]">{currentDate}</span>
              </div>
              <div class="flex items-center gap-2">
                <div class="h-2 w-2 animate-pulse rounded-full bg-[#CC0000]" />
                <span class="font-mono font-semibold text-[#CC0000] text-[9px] uppercase tracking-wider">
                  Secure Access
                </span>
              </div>
            </div>

            {/* Main Headline */}
            <div class="py-3 text-center">
              <div class="mb-2 flex items-center justify-center gap-4">
                <span class="ornament-cross" />
                <span class="font-mono text-[#888888] text-[8px] uppercase tracking-[0.5em]">
                  Est. 2026
                </span>
                <span class="ornament-cross" />
              </div>
              <h1 class="font-black font-display text-[2.25rem] leading-[0.88] tracking-tight sm:text-4.5xl md:text-5.5xl lg:text-6.5xl">
                <span class="text-[#CC0000]">E</span>ragear{" "}
                <span class="text-[#CC0000]">C</span>ode{" "}
                <span class="text-[#CC0000]">C</span>opilot
              </h1>
              {/* Subheadline / Deck */}
              <p class="deck-text mx-auto mt-4 max-w-2xl">
                Agent CLI • Agent Control Protocol
              </p>
            </div>

            {/* Decorative Agents */}
            <div class="mt-4 flex items-center justify-center gap-2">
              <div class="h-px w-6 bg-[#111111]" />
              <span class="">Claude code</span>
              <div class="h-px w-6 bg-[#111111]" />
              <span class="">OpenCode</span>
              <div class="h-px w-6 bg-[#111111]" />
              <span class="">Codex</span>
              <div class="h-px w-6 bg-[#111111]" />
            </div>
          </header>

          {/* Main Grid Layout */}
          <div class="grid grid-cols-1 border-2 border-[#111111] bg-[#F9F9F7] shadow-[6px_6px_0px_0px_#111111] lg:grid-cols-12">
            {/* Left Column - Meta Info */}
            <aside class="hidden flex-col border-[#111111] border-r lg:col-span-3 lg:flex">
              {/* Section Header */}
              <div class="border-[#111111] border-b bg-[#111111] px-4 py-3">
                <div class="flex items-center gap-2">
                  <span class="section-label text-[#F9F9F7]">
                    ◈ Publication Notes
                  </span>
                </div>
              </div>

              {/* Meta Content */}
              <div class="newsprint-lines flex-1 space-y-5 p-4 lg:p-5">
                <div class="border-[#E5E5E0] border-b pb-4">
                  <p class="mb-1 font-mono text-[#888888] text-[8px] uppercase tracking-[0.35em]">
                    Edition
                  </p>
                  <p class="font-bold font-display text-2xl text-[#111111]">
                    Vol. 1.0
                  </p>
                  <p class="mt-0.5 font-sans text-[#666666] text-xs">
                    Server Edition
                  </p>
                </div>

                <div class="border-[#E5E5E0] border-b pb-4">
                  <p class="mb-1 font-mono text-[#888888] text-[8px] uppercase tracking-[0.35em]">
                    Protocol
                  </p>
                  <p class="font-bold font-display text-[#111111] text-lg">
                    ACP Control
                  </p>
                  <p class="mt-0.5 font-sans text-[#666666] text-xs">
                    Agent Protocol v1.0
                  </p>
                </div>

                <div class="border-[#E5E5E0] border-b pb-4">
                  <p class="mb-1 font-mono text-[#888888] text-[8px] uppercase tracking-[0.35em]">
                    Published
                  </p>
                  <p class="font-body text-[#111111] text-sm leading-tight">
                    {currentDate}
                  </p>
                </div>

                {/* Pull Quote */}
                <blockquote class="pull-quote -mx-2 bg-[#F5F5F0] px-4 py-2 text-sm">
                  "All access is logged. Security first. Every authentication
                  attempt leaves a trace."
                </blockquote>

                <div class="border-[#E5E5E0] border-t pt-4">
                  <p class="mb-2 font-mono text-[#888888] text-[8px] uppercase tracking-[0.25em]">
                    Quick Links
                  </p>
                  <ul class="space-y-1.5 font-sans text-[#111111] text-xs">
                    <li class="flex cursor-default items-center gap-2 transition-colors hover:text-[#CC0000]">
                      <span class="text-[#CC0000]">●</span> System Status
                    </li>
                    <li class="flex cursor-default items-center gap-2 transition-colors hover:text-[#CC0000]">
                      <span class="text-[#CC0000]">●</span> Security Logs
                    </li>
                    <li class="flex cursor-default items-center gap-2 transition-colors hover:text-[#CC0000]">
                      <span class="text-[#CC0000]">●</span> Access Control
                    </li>
                  </ul>
                </div>
              </div>
            </aside>

            {/* Center Column - Login Form */}
            <section class="relative col-span-1 border-[#111111] border-r lg:col-span-6">
              {/* Corner Ornaments */}
              {/* <div class="corner-ornament corner-ornament-tl lg:hidden" /> */}
              {/* <div class="corner-ornament corner-ornament-tr lg:hidden" /> */}

              {/* Section Header */}
              <div class="border-[#111111] border-b bg-[#E5E5E0] px-4 py-3">
                <div class="flex items-center gap-2">
                  <span class="h-2 w-2 bg-[#CC0000]" />
                  <span class="section-label font-semibold text-[#111111]">
                    Breaking: Authentication Required
                  </span>
                </div>
              </div>

              {/* Form Content */}
              <div class="newsprint-lines p-6 sm:p-8 md:p-10">
                {/* Headline for the form section */}
                <div class="form-heading-animate mb-6 border-[#111111] border-b-2 pb-4">
                  <p class="mb-2 font-mono font-semibold text-[#CC0000] text-[9px] uppercase tracking-[0.3em]">
                    Front Page Story
                  </p>
                  <h3
                    class="font-black font-display text-2xl leading-tight sm:text-3xl"
                    id="form-heading"
                  >
                    Authentication Gateway
                  </h3>
                  <p class="byline">
                    By Eragear System • Secure Access Protocol
                  </p>
                </div>

                {/* Subheader */}
                <div class="mb-8 border-[#E5E5E0] border-b pb-3">
                  <p class="font-mono text-[#888888] text-[9px] uppercase tracking-[0.3em]">
                    ▼ Enter Credentials Below
                  </p>
                </div>

                {/* Form */}
                <form
                  aria-labelledby="form-heading"
                  class="space-y-10"
                  id="login-form"
                  noValidate
                >
                  <div class="space-y-8">
                    <div class="field-group group">
                      <div class="flex items-baseline gap-3">
                        <span aria-hidden="true" class="field-number">
                          ①
                        </span>
                        <label
                          class="mb-2 block font-mono text-[#111111] text-[9px] uppercase tracking-[0.25em] transition-colors group-focus-within:text-[#CC0000]"
                          htmlFor="username"
                          id="username-label"
                        >
                          Username Identification
                        </label>
                      </div>
                      <div class="input-wrapper" id="username-wrapper">
                        <input
                          aria-describedby="username-description"
                          aria-invalid="false"
                          aria-required="true"
                          autoComplete="username"
                          class="input-underline w-full"
                          id="username"
                          name="username"
                          placeholder="Enter your username..."
                          required
                          type="text"
                          value={username ?? ""}
                        />
                      </div>
                      <p
                        class="mt-1 font-mono text-[#999999] text-[8px]"
                        id="username-description"
                      >
                        Your unique system identifier
                      </p>
                    </div>

                    <div class="field-group group">
                      <div class="flex items-baseline gap-3">
                        <span aria-hidden="true" class="field-number">
                          ②
                        </span>
                        <label
                          class="mb-2 block font-mono text-[#111111] text-[9px] uppercase tracking-[0.25em] transition-colors group-focus-within:text-[#CC0000]"
                          htmlFor="password"
                          id="password-label"
                        >
                          Password Secret Key
                        </label>
                      </div>
                      <div class="input-wrapper" id="password-wrapper">
                        <input
                          aria-describedby="password-description"
                          aria-invalid="false"
                          // aria-required="true"
                          autoComplete="current-password"
                          class="input-underline w-full pr-12"
                          id="password"
                          name="password"
                          placeholder="Enter your password..."
                          required
                          type="password"
                        />
                        <button
                          aria-label="Show password"
                          aria-pressed="false"
                          class="password-toggle"
                          id="password-toggle"
                          type="button"
                        >
                          👁
                        </button>
                      </div>
                      <p
                        class="mt-1 font-mono text-[#999999] text-[8px]"
                        id="password-description"
                      >
                        Your secure access credential
                      </p>
                    </div>
                  </div>

                  {/* Submit Button */}
                  <div class="pt-6">
                    <button
                      class="sharp-corners flex w-full items-center justify-center gap-2 border-2 border-[#111111] bg-[#111111] px-8 py-4 font-mono text-[#F9F9F7] text-xs uppercase tracking-[0.3em] shadow-[3px_3px_0px_0px_#CC0000] transition-all duration-200 hover:translate-x-[1.5px] hover:translate-y-[1.5px] hover:bg-[#111111] hover:text-[#F9F9F7] hover:shadow-[1.5px_1.5px_0px_0px_#CC0000] focus:translate-x-[1.5px] focus:translate-y-[1.5px] focus:shadow-[1.5px_1.5px_0px_0px_#CC0000] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#CC0000] focus-visible:outline-offset-2 active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
                      id="submit-btn"
                      type="submit"
                    >
                      <span id="submit-text">▶ Access System</span>
                      <span class="spinner hidden" id="submit-spinner" />
                    </button>
                  </div>
                </form>

                {/* Error Message */}
                <div
                  aria-atomic="true"
                  aria-live="assertive"
                  class="sharp-corners mt-8 hidden border-2 border-[#CC0000] bg-[#CC0000]/5 p-4 font-mono text-[#CC0000] text-xs uppercase tracking-wider"
                  id="login-error"
                  // role="status"
                >
                  <span class="mr-2">⚠</span>
                  <span id="error-text" />
                </div>

                {/* Footer note in form area */}
                <div class="mt-8 flex items-center justify-center gap-3 border-[#E5E5E0] border-t pt-4 font-mono text-[#888888] text-[9px] uppercase tracking-wider">
                  <span class="ornament-diamond" />
                  <span>Secure Authentication Protocol Active</span>
                  <span class="ornament-diamond" />
                </div>
              </div>
            </section>

            {/* Right Column - Stats/Info */}
            <aside class="col-span-1 lg:col-span-3">
              {/* Section Header */}
              <div class="border-[#111111] border-b bg-[#111111] px-4 py-3">
                <div class="flex items-center gap-2">
                  <span class="section-label text-[#F9F9F7]">
                    ◈ System Status
                  </span>
                </div>
              </div>

              {/* Status Content */}
              <div class="newsprint-lines space-y-4 p-4 lg:p-5">
                {/* Live Status */}
                <div class="flex items-center gap-3 border-[#E5E5E0] border-b pb-4">
                  <div class="relative">
                    <div class="h-3.5 w-3.5 border-2 border-[#111111]" />
                    <div
                      class="pulse-dot absolute top-0 left-0 h-full w-full animate-pulse bg-[#CC0000]"
                      style={{
                        clipPath: "polygon(50% 0%, 0% 100%, 100% 100%)",
                      }}
                    />
                  </div>
                  <div>
                    <p class="font-mono text-[#888888] text-[8px] uppercase tracking-[0.25em]">
                      System State
                    </p>
                    <p class="font-bold font-display text-[#111111] text-xl">
                      ● Online
                    </p>
                  </div>
                </div>

                {/* Encryption */}
                <div class="flex items-center gap-3 border-[#E5E5E0] border-b pb-4">
                  <div class="flex h-9 w-9 items-center justify-center bg-[#111111] font-mono text-[#F9F9F7] text-base">
                    ⌘
                  </div>
                  <div>
                    <p class="font-mono text-[#888888] text-[8px] uppercase tracking-[0.25em]">
                      Encryption
                    </p>
                    <p class="font-bold font-sans text-[#111111] text-sm">
                      ◆ Active TLS
                    </p>
                  </div>
                </div>

                {/* Warning Box */}
                <div class="bg-[#111111] p-4 text-[#F9F9F7]">
                  <p class="mb-2 font-mono text-[#CC0000] text-[9px] uppercase tracking-[0.25em]">
                    ⚠ Security Notice
                  </p>
                  <p class="font-body text-[#E5E5E0] text-xs leading-relaxed">
                    This is a restricted system. All authentication attempts are
                    logged and monitored by security protocols.
                  </p>
                </div>

                {/* Stats */}
                <div class="pt-2">
                  <p class="mb-3 font-mono text-[#888888] text-[8px] uppercase tracking-[0.25em]">
                    System Metrics
                  </p>
                  <div class="space-y-2 font-sans text-xs">
                    <div class="flex cursor-default justify-between border-[#E5E5E0] border-b pb-1.5 transition-colors hover:border-[#CC0000]/30 hover:text-[#CC0000]">
                      <span class="text-[#888888]">Uptime</span>
                      <span class="font-semibold text-[#111111]">99.9%</span>
                    </div>
                    <div class="flex cursor-default justify-between border-[#E5E5E0] border-b pb-1.5 transition-colors hover:border-[#CC0000]/30 hover:text-[#CC0000]">
                      <span class="text-[#888888]">Version</span>
                      <span class="font-semibold text-[#111111]">v1.0.0</span>
                    </div>
                    <div class="flex cursor-default justify-between pb-1 transition-colors hover:text-[#CC0000]">
                      <span class="text-[#888888]">Protocol</span>
                      <span class="font-semibold text-[#111111]">ACP</span>
                    </div>
                  </div>
                </div>
              </div>
            </aside>
          </div>

          {/* Final decorative rule */}
          <div class="mt-4 flex items-center justify-center gap-2 opacity-40">
            <span class="ornament-cross" />
            <div class="h-px w-24 bg-[#111111]" />
            <span class="ornament-star text-[#CC0000]">✦</span>
            <div class="h-px w-24 bg-[#111111]" />
            <span class="ornament-cross" />
          </div>
        </main>

        {/* Footer - Outside main for sticky bottom */}
        <footer class="relative mt-auto border-[#111111] border-t-4 bg-[#F9F9F7] pt-4">
          {/* Corner Ornaments */}
          {/* <div class="corner-ornament corner-ornament-bl" /> */}
          {/* <div class="corner-ornament corner-ornament-br" /> */}

          <div class="mx-auto max-w-[1400px] px-3 sm:px-4 md:px-6 lg:px-8">
            <div class="flex flex-wrap items-center justify-between gap-4 font-mono text-[#888888] text-[9px] uppercase tracking-wider">
              <div class="flex items-center gap-4">
                <span class="bg-[#111111] px-2 py-0.5 text-[#F9F9F7]">
                  © 2026
                </span>
                <span class="font-bold text-[#111111]">Eragear</span>
                <span class="hidden text-[#999999] sm:inline">|</span>
                <span class="hidden text-[#888888] sm:inline">
                  All Rights Reserved
                </span>
              </div>
              <div class="flex items-center gap-4">
                <span class="flex items-center gap-2">
                  <span class="h-1.5 w-1.5 rounded-full bg-[#CC0000]" />
                  <span class="text-[#111111]">Secure Connection</span>
                </span>
                <span class="ornament-diamond" />
                <span>ACP Enabled</span>
              </div>
            </div>
          </div>
        </footer>

        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Inline logic for small form
          dangerouslySetInnerHTML={{
            __html: `
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
            `,
          }}
        />
      </body>
    </html>
  );
}
