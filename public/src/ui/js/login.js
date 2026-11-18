'use strict';

/**
 * Mine lock screen.
 *
 * Renders the sign-in panel in the app's own design language: a dark
 * brand panel beside a light credential card, on the paper canvas.
 *
 * The markup is authored here rather than in index.html so the lock screen
 * and the main shell always agree on the brand.
 */

(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  const MINE_LOGIN_HTML = `
<div class="auth-layout">
  <section class="auth-aside" aria-label="Mine">
    <div class="auth-brand">
      <img src="assets/mine_icon.png" alt="Mine" class="auth-mark-img">
      <div>
        <strong>Mine</strong>
        <span>Cloud AI gateway</span>
      </div>
    </div>
    <h1>Your keys, one endpoint.</h1>
    <p>Pool API keys across providers and serve them from one OpenAI-compatible endpoint, hosted on Vercel and reachable from anywhere.</p>
    <div class="auth-signal-list">
      <div class="auth-signal"><span>Gateway</span><strong>Online</strong></div>
      <div class="auth-signal"><span>Key vault</span><strong>Encrypted</strong></div>
      <div class="auth-signal"><span>Session</span><strong>Signed cookie</strong></div>
    </div>
  </section>

  <section class="auth-card">
    <div class="auth-eyebrow">Locked console</div>
    <h2>Welcome back.</h2>
    <p class="auth-lead">Enter your password to open the Mine console.</p>

    <form class="auth-form" id="lock-form" novalidate>
      <div class="auth-field">
        <label for="lock-password-input">Password</label>
        <div class="auth-input-wrap">
          <input class="auth-input" id="lock-password-input" type="password"
                 placeholder="Enter your password" autocomplete="current-password" required autofocus>
          <button class="auth-password-toggle" type="button" aria-label="Show password">Show</button>
        </div>
      </div>

      <div class="auth-field" id="lock-confirm-field" hidden>
        <label for="lock-password-confirm">Confirm password</label>
        <div class="auth-input-wrap">
          <input class="auth-input" id="lock-password-confirm" type="password"
                 placeholder="Repeat the password" autocomplete="new-password">
        </div>
      </div>

      <p class="auth-error" id="lock-error-msg" role="alert" aria-live="polite" hidden></p>

      <button class="btn btn-primary auth-submit" type="submit" id="btn-unlock">Unlock console</button>

      <div id="lock-timer-box" class="lock-timer-badge" style="display:none">
        <span>Too many attempts</span>
        <span><span id="lock-countdown">30</span>s</span>
      </div>
    </form>

    <p class="auth-foot" id="auth-foot">Your password is hashed with PBKDF2-SHA512 on the server and the vault is encrypted with AES-256-GCM. <strong>Keys never leave your deployment.</strong></p>
  </section>
</div>`;

  function injectLoginStyles() {
    if (typeof document === 'undefined') return;
    let styleEl = document.getElementById('login-vault-styles');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'login-vault-styles';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = MINE_LOGIN_CSS;
  }

  /**
   * Guarded wrapper around handleUnlock so a double submit cannot run the
   * password check twice.
   */
  let unlocking = false;
  async function triggerUnlock(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    if (unlocking) return;
    unlocking = true;
    try {
      if (typeof root.handleUnlock === 'function') {
        await root.handleUnlock();
      }
    } finally {
      setTimeout(() => {
        unlocking = false;
      }, 300);
    }
  }

  function toggleAuthPassword() {
    const input = document.getElementById('lock-password-input');
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    const btn = document.querySelector('.auth-password-toggle');
    if (btn) {
      btn.textContent = show ? 'Hide' : 'Show';
      btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    }
  }

  function hookLoginEvents(container) {
    if (!container) return;
    const form = container.querySelector('#lock-form');
    const btn = container.querySelector('#btn-unlock');
    if (btn) btn.onclick = triggerUnlock;
    if (form) form.onsubmit = triggerUnlock;
    const toggle = container.querySelector('.auth-password-toggle');
    if (toggle) toggle.onclick = toggleAuthPassword;
    applyLoginMode(container);
  }

  /**
   * First visit to a fresh deployment: the card becomes "create a password".
   */
  function applyLoginMode(container) {
    const c = container || document.getElementById('startup-auth-box');
    if (!c) return;
    const S = root.S || {};
    const setup = !!(S.auth && S.auth.needsSetup);
    const eyebrow = c.querySelector('.auth-eyebrow');
    const h2 = c.querySelector('.auth-card h2');
    const lead = c.querySelector('.auth-lead');
    const confirmField = c.querySelector('#lock-confirm-field');
    const input = c.querySelector('#lock-password-input');
    const btn = c.querySelector('#btn-unlock');
    if (setup) {
      if (eyebrow) eyebrow.textContent = 'First-time setup';
      if (h2) h2.textContent = 'Secure your console.';
      if (lead) lead.textContent = 'Create the password that protects this Mine deployment. Anyone with the link sees this screen, so pick a strong one (8+ characters).';
      if (confirmField) confirmField.hidden = false;
      if (input) { input.placeholder = 'Create a password'; input.autocomplete = 'new-password'; }
      if (btn) btn.textContent = 'Create password & open';
    } else {
      if (eyebrow) eyebrow.textContent = 'Locked console';
      if (h2) h2.textContent = 'Welcome back.';
      if (lead) lead.textContent = 'Enter your password to open the Mine console.';
      if (confirmField) confirmField.hidden = true;
      if (input) { input.placeholder = 'Enter your password'; input.autocomplete = 'current-password'; }
      if (btn) btn.textContent = 'Unlock console';
    }
  }

  function renderMineLogin(target) {
    injectLoginStyles();

    let container = null;
    if (typeof target === 'string') {
      container = document.querySelector(target);
    } else if (target && target.nodeType) {
      container = target;
    } else if (typeof document !== 'undefined') {
      container = document.getElementById('startup-auth-box');
    }

    if (container) {
      container.innerHTML = MINE_LOGIN_HTML;
      hookLoginEvents(container);
    }

    return MINE_LOGIN_HTML;
  }

  const MINE_LOGIN_CSS = `
.auth-layout{
  width:min(1060px,100%);display:grid;grid-template-columns:minmax(0,1.05fr) minmax(340px,.95fr);
  gap:22px;align-items:stretch;min-width:0;
}
.auth-aside,.auth-card{
  min-width:0;border-radius:20px;position:relative;overflow:hidden;animation:auth-fade .5s ease both;
}
.auth-card{animation-delay:.07s;}

.auth-aside{
  padding:34px;background:var(--sidebar-bg);color:var(--sidebar-text);
  border:1px solid var(--line);box-shadow:12px 16px 0 -5px var(--chart-shadow),var(--shadow);
  display:flex;flex-direction:column;
}
.auth-aside::after{
  content:"";position:absolute;width:250px;height:250px;right:-100px;bottom:-110px;border-radius:50%;
  background:var(--mint);opacity:.18;pointer-events:none;
}
.auth-aside::before{
  content:"";position:absolute;inset:16px;border:1px solid rgba(223,223,223,.16);
  border-radius:14px;pointer-events:none;
}
.auth-brand{display:flex;align-items:center;gap:12px;position:relative;z-index:1}
.auth-mark-img{width:44px;height:44px;border-radius:12px;object-fit:cover;flex:none;box-shadow:3px 3px 0 var(--accent)}
.auth-brand strong{display:block;font-family:var(--font-display);font-size:19px;letter-spacing:-.03em;color:var(--sidebar-text)}
.auth-brand span{display:block;font-size:11px;opacity:.62;margin-top:2px;color:var(--sidebar-text)}

.auth-aside h1{
  font-family:var(--font-display);font-size:clamp(34px,4.6vw,54px);line-height:1;letter-spacing:-.055em;
  max-width:9ch;margin:64px 0 18px;position:relative;z-index:1;color:var(--sidebar-text);
}
.auth-aside p{
  max-width:36ch;color:rgba(235,240,234,.68);font-size:13px;line-height:1.65;margin:0;
  position:relative;z-index:1;
}
.auth-signal-list{display:grid;gap:2px;margin-top:auto;padding-top:44px;position:relative;z-index:1}
.auth-signal{
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:12px 0;border-bottom:1px solid rgba(223,223,223,.16);font-size:12px;
}
.auth-signal span{color:rgba(235,240,234,.6)}
.auth-signal strong{font-size:11px;font-weight:700;color:var(--sidebar-text)}
.auth-signal strong::before{
  content:"";display:inline-block;width:7px;height:7px;margin-right:7px;border-radius:50%;
  background:var(--mint);box-shadow:0 0 0 4px var(--mint-soft);
}

.auth-card{
  padding:34px;background:var(--sf);color:var(--text);
  border:1px solid var(--line-strong);box-shadow:12px 16px 0 -5px var(--chart-shadow),var(--shadow);
  display:flex;flex-direction:column;justify-content:center;
}
.auth-eyebrow{
  font-family:var(--font-display);font-size:11px;font-weight:700;letter-spacing:.04em;
  text-transform:none;color:var(--accent-strong);
}
.auth-card h2{font-family:var(--font-display);font-size:28px;letter-spacing:-.05em;margin:12px 0 8px}
.auth-lead{font-size:13px;line-height:1.6;color:var(--text-muted);margin:0 0 26px}
.auth-form{display:grid;gap:15px}
.auth-field{display:grid;gap:7px}
.auth-field label{font-size:11px;color:var(--text-muted);font-weight:700;letter-spacing:.03em}
.auth-input-wrap{position:relative}
.auth-input{
  width:100%;padding:13px 14px;border:1px solid var(--line-strong);border-radius:10px;
  background:var(--sf);color:var(--text);font-size:13px;outline:none;
  transition:border-color .15s,box-shadow .15s;
}
.auth-input::placeholder{color:var(--text-faint)}
.auth-input:focus{border-color:var(--accent);box-shadow:4px 4px 0 var(--chart-shadow-soft)}
.auth-password-toggle{
  position:absolute;right:8px;top:50%;transform:translateY(-50%);border:0;background:transparent;
  color:var(--text-muted);font-size:11px;font-weight:700;padding:7px;cursor:pointer;
}
.auth-password-toggle:hover{color:var(--accent-strong)}
.auth-error{min-height:18px;color:var(--bad);font-size:11.5px;font-weight:700;margin:0}
.auth-submit{width:100%;min-height:44px}
.auth-foot{font-size:11px;line-height:1.55;color:var(--text-faint);margin:22px 0 0}
.auth-foot strong{color:var(--text-muted)}
.lock-timer-badge{
  display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px;
  padding:9px 12px;border-radius:10px;background:var(--badb);
  border:1px solid var(--bad);color:var(--bad);font-size:11.5px;font-weight:700;
}
@keyframes auth-fade{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}

@media(max-width:860px){
  .auth-layout{grid-template-columns:1fr;max-width:520px;gap:16px}
  .auth-aside{padding:26px}
  .auth-aside h1{margin:36px 0 14px;font-size:38px}
  .auth-signal-list{padding-top:28px}
  .auth-card{padding:26px}
}
@media(max-width:480px){
  .auth-card{padding:20px}
  .auth-aside{padding:22px}
  .auth-aside h1{font-size:32px}
}
`;

  if (typeof document !== 'undefined') {
    const paint = () => {
      const authBox = document.getElementById('startup-auth-box');
      if (authBox) renderMineLogin(authBox);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', paint);
    } else {
      paint();
    }
  }

  root.renderMineLogin = renderMineLogin;
  root.applyLoginMode = applyLoginMode;
  root.injectLoginStyles = injectLoginStyles;
  root.triggerUnlock = triggerUnlock;
  root.toggleAuthPassword = toggleAuthPassword;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      renderMineLogin,
      injectLoginStyles,
      triggerUnlock,
      toggleAuthPassword,
      MINE_LOGIN_HTML,
      MINE_LOGIN_CSS,
    };
  }
})();
