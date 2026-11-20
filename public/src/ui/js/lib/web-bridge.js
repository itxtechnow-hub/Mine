'use strict';

/**
 * Web bridge.
 *
 * Recreates the Electron preload API (`window.vault`) on top of the hosted
 * backend at POST /api/rpc, so the original console runs unchanged in a
 * browser. Gateway events that Electron pushed over IPC are delivered by a
 * light poller instead.
 */

(function () {
  const root = window;
  let lockedNotified = false;

  async function call(method) {
    const args = Array.prototype.slice.call(arguments, 1);
    let res;
    try {
      res = await fetch('/api/rpc', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, args }),
      });
    } catch (err) {
      throw new Error('Network error: ' + err.message);
    }

    let json = null;
    try {
      json = await res.json();
    } catch (_) {
      json = null;
    }

    if (res.status === 401 && json && json.locked) {
      onSessionLost();
      throw new Error('Not signed in');
    }
    if (!json || !json.ok) {
      throw new Error((json && json.error) || 'Request failed (' + res.status + ')');
    }
    lockedNotified = false;
    return json.result;
  }

  function onSessionLost() {
    if (lockedNotified) return;
    lockedNotified = true;
    stopPolling();
    if (root.S) root.S.unlocked = false;
    if (typeof root.showStartupScreen === 'function') root.showStartupScreen(true);
  }

  // Wrap so a failed call resolves to a sensible value instead of crashing
  // view code that does not expect a rejection.
  function safe(method, fallback) {
    return function () {
      const args = Array.prototype.slice.call(arguments);
      return call.apply(null, [method].concat(args)).catch((err) => {
        console.warn('[mine] ' + method + ': ' + err.message);
        if (typeof fallback === 'function') return fallback(err);
        return fallback;
      });
    };
  }

  const fail = (err) => ({ success: false, error: err.message });

  // ── Event emulation ──────────────────────────────────────────────────────
  const listeners = new Map(); // channel -> Set<fn>
  function emit(channel, payload) {
    const set = listeners.get(channel);
    if (!set) return;
    set.forEach((fn) => {
      try {
        fn(payload);
      } catch (_) {}
    });
  }

  let pollTimer = null;
  let lastLogTs = null;
  let polling = false;

  function anyDialogOpen() {
    return !!document.querySelector('dialog[open]');
  }

  function userIsEditing() {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  async function pollOnce() {
    const S = root.S;
    if (!S || !S.unlocked || polling || document.hidden) return;
    polling = true;
    try {
      const data = await call('gateway:poll', lastLogTs);
      let changed = false;

      if (Array.isArray(data.logs) && data.logs.length) {
        const fresh = lastLogTs ? data.logs : data.logs.slice();
        if (lastLogTs) {
          S.logs = fresh.concat(S.logs || []).slice(0, 200);
          fresh
            .slice()
            .reverse()
            .forEach((entry) => emit('gateway:requestLog', entry));
        } else {
          S.logs = fresh.slice(0, 200);
        }
        lastLogTs = data.logs[0].timestamp;
        changed = true;
      } else if (!lastLogTs) {
        S.logs = [];
        lastLogTs = '';
      }

      if (data.analytics) S.analytics = data.analytics;

      if (Array.isArray(data.keys) && Array.isArray(S.keys)) {
        const byId = new Map(data.keys.map((k) => [k.id, k]));
        for (const k of S.keys) {
          const u = byId.get(k.id);
          if (!u) continue;
          if (u.status !== k.status || u.usageTotal !== k.usageTotal) {
            Object.assign(k, u);
            emit('gateway:keyUpdate', { keyId: k.id, ...u });
            changed = true;
          }
        }
      }

      if (typeof data.running === 'boolean' && data.running !== S.gatewayRunning) {
        S.gatewayRunning = data.running;
        changed = true;
      }

      if (data.activeKey && data.activeKey.timestamp !== (S._lastActiveTs || 0)) {
        S._lastActiveTs = data.activeKey.timestamp;
        S.activeRotatingKeyId = data.activeKey.keyId;
        S.activeModelName = data.activeKey.model;
        emit('gateway:activeKey', data.activeKey);
      }

      if (changed && typeof root.render === 'function' && (S.page === 'overview' || S.page === 'keys')) {
        if (!anyDialogOpen() && !userIsEditing()) root.render();
      } else if (changed && typeof root.updateGatewayPill === 'function') {
        root.updateGatewayPill();
      }
    } catch (_) {
      /* transient */
    } finally {
      polling = false;
    }
  }

  function startPolling() {
    if (pollTimer) return;
    lastLogTs = null;
    pollOnce();
    pollTimer = setInterval(pollOnce, 5000);
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pollOnce();
  });

  // ── Clipboard ────────────────────────────────────────────────────────────
  async function writeClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const t = document.createElement('textarea');
      t.value = text;
      t.style.position = 'fixed';
      t.style.opacity = '0';
      document.body.appendChild(t);
      t.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (_) {}
      t.remove();
      return ok;
    }
  }

  // ── The bridge ───────────────────────────────────────────────────────────
  root.vault = {
    hosted: true,

    store: {
      get: safe('store:get', (err) => undefined),
      set: safe('store:set', false),
      delete: safe('store:delete', false),
      clear: safe('store:clear', false),
      reset: safe('store:reset', fail),
      getAll: safe('store:getAll', {}),
      getMetrics: safe('store:getStorageMetrics', fail),
      clean: safe('store:cleanStorage', fail),
    },

    gateway: {
      start: () => safe('gateway:start', fail)(),
      stop: safe('gateway:stop', fail),
      status: safe('gateway:status', { running: false, host: null, port: null, stats: {} }),
      clientConfig: safe('gateway:clientConfig', null),
      syncConfig: safe('gateway:syncConfig', false),
      testKey: safe('gateway:testKey', fail),
      testAllKeys: safe('gateway:testAllKeys', []),
      poll: safe('gateway:poll', null),
      copyKey: async () => {
        try {
          const res = await call('gateway:copyKey');
          if (!res || !res.key) return { success: false, error: 'No gateway key yet' };
          const ok = await writeClipboard(res.key);
          return ok ? { success: true } : { success: false, error: 'Clipboard blocked by the browser' };
        } catch (err) {
          return fail(err);
        }
      },
      revealKey: safe('gateway:revealKey', fail),
      rotateKey: safe('gateway:rotateKey', fail),
    },

    keys: {
      add: safe('key:add', []),
      replace: safe('key:replace', fail),
      remove: safe('key:remove', fail),
      prune: safe('key:prune', fail),
      setEnabled: safe('key:setEnabled', fail),
    },

    crypto: {
      encrypt: safe('crypto:encrypt', fail),
      decrypt: safe('crypto:decrypt', fail),
      encryptBackup: (text, password) => safe('crypto:encryptBackup', fail)({ text, password }),
      decryptBackup: (bundle, password) => safe('crypto:decryptBackup', fail)({ bundle, password }),
    },

    analytics: {
      get: safe('analytics:get', null),
    },

    time: {
      fetch: safe('time:fetch', fail),
    },

    auth: {
      getStatus: safe('auth:getStatus', { enabled: true, hasPassword: true, authenticated: false }),
      setPassword: safe('auth:setPassword', fail),
      verify: safe('auth:verify', fail),
      disable: safe('auth:disable', fail),
      logout: safe('auth:logout', fail),
    },

    providers: {
      getCustom: safe('providers:getCustom', []),
      configureCloudflare: safe('providers:configureCloudflare', fail),
      addCustom: safe('providers:addCustom', []),
      removeCustom: safe('providers:removeCustom', []),
      update: safe('providers:update', fail),
    },

    models: {
      fetchFromKeys: safe('models:fetchFromKeys', (err) => ({
        success: false,
        error: err.message,
        models: [],
        count: 0,
        results: [],
        errors: [],
      })),
      ping: safe('models:ping', fail),
      setQueue: safe('modelQueue:set', fail),
    },

    automation: {
      get: safe('automation:get', { config: {}, history: [] }),
      save: safe('automation:save', fail),
      run: safe('automation:run', fail),
    },

    teams: {
      get: safe('teams:get', []),
      set: safe('teams:set', fail),
      remove: safe('teams:remove', fail),
    },

    cloudMemory: {
      get: safe('cloudMemory:get', fail),
      save: safe('cloudMemory:save', fail),
      delete: safe('cloudMemory:delete', fail),
      approveDelete: safe('cloudMemory:approveDelete', fail),
      setPermissions: safe('cloudMemory:setPermissions', fail),
      setModelPermissions: safe('cloudMemory:setModelPermissions', fail),
      setServers: safe('cloudMemory:setServers', fail),
    },

    on: (channel, callback) => {
      if (typeof callback !== 'function') return;
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(callback);
    },

    off: (channel, callback) => {
      const set = listeners.get(channel);
      if (set) set.delete(callback);
    },

    openExternal: async (url) => {
      try {
        const u = new URL(url);
        if (u.protocol !== 'https:' && u.protocol !== 'mailto:') {
          return { success: false, error: 'Only https and mailto links can be opened' };
        }
        window.open(u.toString(), '_blank', 'noopener,noreferrer');
        return { success: true };
      } catch (_) {
        return { success: false, error: 'Invalid URL' };
      }
    },

    setTitle: async (title) => {
      if (typeof title === 'string' && title.length < 120) document.title = title;
    },

    getVersion: safe('app:getVersion', { version: 'web' }),

    // Web-only lifecycle hooks used by app.js.
    _startPolling: startPolling,
    _stopPolling: stopPolling,
    _pollNow: pollOnce,
  };
})();
