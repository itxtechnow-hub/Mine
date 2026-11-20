'use strict';

/**
 * Shared helpers and application state.
 *
 * Loaded before every other renderer module. Everything here is exposed on
 * `window` by the bootstrap in app.js so the view modules can reach it.
 */

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) =>
  n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(n || 0);

const maskKey = (k) => {
  const s = String(k || '');
  if (s.length <= 10) return s ? s.slice(0, 3) + '...' : '';
  return s.slice(0, 6) + '...' + s.slice(-4);
};

const S = {
  page: 'overview',
  keys: [],
  logs: [],
  models: [],
  customProviders: [],
  settings: {
    on: 1,
    host: '127.0.0.1',
    port: 4000,
    vkey: 1,
    rotate: 1,
    retries: 3,
    cd: 60,
    autoStart: 0,
    theme: 'light',
    clusterDensity: 'compact',
  },
  period: 'today',
  analytics: { daily: {}, weekly: {}, monthly: {}, yearly: {}, allTime: { requests: 0, tokens: 0, totalLatency: 0 } },
  auth: { enabled: false, hasPassword: false },
  unlocked: false,
  gatewayRunning: false,
  activeRotatingKeyId: null,
  activeModelName: null,
  modelProviderQuery: '',
  modelQuery: '',
  modelFreeOnly: false,
  blockedModels: [],
  showBlocked: false,
  collapsedProviders: {},
  selectedTool: 'vscode-copilot',
  pf: 'ALL',
  modelQueue: [],
  gatewayConfig: {
    baseUrl: 'http://127.0.0.1:4000/v1',
    modelsUrl: 'http://127.0.0.1:4000/v1/models',
    healthUrl: 'http://127.0.0.1:4000/health',
    apiKey: '',
    requiresApiKey: true,
  },
};

const STL = {
  ACTIVE: ['Active', 'ok'],
  DEAD: ['Dead', 'bad'],
  COOLDOWN: ['Cooldown', 'warn'],
  CREDIT_EMPTY: ['No Credits', 'bad'],
  UNKNOWN: ['Unknown', 'warn'],
  UNTESTED: ['Untested', 'warn'],
};

function getAllProviders() {
  const builtins = Array.isArray(PROVIDER_DIRECTORY) ? PROVIDER_DIRECTORY : [];
  const customs = Array.isArray(S.customProviders) ? S.customProviders : [];
  const byId = new Map();
  for (const p of builtins) if (p && p.id) byId.set(p.id, p);
  for (const p of customs) if (p && p.id) byId.set(p.id, { ...byId.get(p.id), ...p, custom: true });
  return [...byId.values()];
}

function getProvider(id) {
  if (!id) return null;
  return getAllProviders().find((p) => p.id === id || p.name === id) || null;
}

function visibleDiscoveredModels() {
  const blocked = new Set(S.blockedModels || []);
  return (S.models || []).filter((m) => !blocked.has(m.id));
}

function gwUrl() {
  return S.gatewayConfig.baseUrl || 'http://127.0.0.1:4000/v1';
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2400);
}

async function copy(text, msg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg || 'Copied to clipboard');
  } catch (_) {
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.select();
    document.execCommand('copy');
    helper.remove();
    toast(msg || 'Copied to clipboard');
  }
}

function dl(name, content, type) {
  const blob = new Blob([content], { type: type || 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Tier badge for an API key.
 *
 * Returns ready-to-insert HTML. A key is treated as free tier when the
 * provider is known to be free, when a model discovered through it was
 * flagged free, or when the key itself was tagged.
 */
function getKeyTierBadge(k, p) {
  if (!k) return '';

  const errStr = String(k.lastError || '').toLowerCase();
  const statusStr = String(k.status || '').toUpperCase();

  const isCreditExhausted =
    statusStr === 'CREDIT_EMPTY' ||
    errStr.includes('402') ||
    errStr.includes('credit') ||
    errStr.includes('insufficient_quota') ||
    errStr.includes('quota') ||
    errStr.includes('balance') ||
    errStr.includes('payment');

  if (isCreditExhausted) {
    return '<span class="chip warn" style="font-size:10px;font-weight:700" title="Credit limit reached or quota exhausted">Credit Exhausted</span>';
  }

  const pid = String(k.provider || k.providerId || (p && p.id) || '').toLowerCase();
  const isKnownFree =
    ['groq', 'cerebras', 'google', 'gemini', 'chutes', 'pollinations', 'ollama', 'lmstudio', 'vllm'].includes(pid) ||
    (k.key && (k.key.startsWith('gsk_') || k.key.startsWith('csk-') || k.key.startsWith('AIza')));

  const hasFreeDiscovered = ((S && S.models) || []).some((m) => m.sourceKeyId === k.id && m.free);

  if (isKnownFree || hasFreeDiscovered || k.tier === 'free') {
    return '<span class="chip ok" style="font-size:10px;font-weight:700" title="Free tier API key">Free Tier</span>';
  }

  return '<span class="chip paid-tier-chip" style="font-size:10px;font-weight:700" title="Paid tier API key">Paid Tier</span>';
}

/**
 * Apply the theme preference and keep the settings select in sync.
 * 'system' follows the operating system.
 */
function syncThemeState() {
  const pref = S.settings.theme || 'light';
  const resolved =
    pref === 'system'
      ? window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : pref;

  document.documentElement.setAttribute('data-theme', resolved);

  document.querySelectorAll('select[data-s="theme"]').forEach((sel) => {
    sel.value = pref;
  });

  const btn = document.getElementById('themeBtn');
  if (btn) btn.textContent = resolved === 'dark' ? '☀' : '☾';

  return resolved;
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  S.settings.theme = current === 'dark' ? 'light' : 'dark';
  syncThemeState();
  if (window.vault && window.vault.store) {
    window.vault.store.set('settings', S.settings);
  }
}

if (window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (S.settings.theme === 'system') syncThemeState();
  };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else if (mq.addListener) mq.addListener(onChange);
}

window.$ = $;
window.esc = esc;
window.fmt = fmt;
window.maskKey = maskKey;
window.S = S;
window.STL = STL;
window.getProvider = getProvider;
window.getAllProviders = getAllProviders;
window.visibleDiscoveredModels = visibleDiscoveredModels;
window.gwUrl = gwUrl;
window.toast = toast;
window.copy = copy;
window.dl = dl;
window.getKeyTierBadge = getKeyTierBadge;
window.syncThemeState = syncThemeState;
window.toggleTheme = toggleTheme;
