'use strict';

const { URL } = require('url');

const {
  MAX_LOG_ENTRIES,
  DEFAULT_TIMEOUT_MS,
  CORS_HEADERS,
  PROXY_PATHS,
  jsonResponse,
  errorResponse,
  readBody,
  safeEqual,
  CircularLog,
} = require('./http-util');

const {
  resolveProvider,
  stripProviderPrefix,
  matchProvider,
  chooseAutomaticModel,
  resolveUpstreamUrl,
  normalizeUpstreamModel,
} = require('./providers');

const { proxyRequest } = require('./upstream');
const { selectBestUntried, keyLabel, buildLog } = require('./key-rotation');
const { runTeam } = require('./team');
const { automaticCandidates } = require('./providers');

const HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
  'transfer-encoding', 'upgrade', 'content-length', 'accept-encoding', 'content-encoding',
  'cookie', 'forwarded', 'x-real-ip', 'cdn-loop', 'via',
]);

/**
 * The Mine local gateway.
 *
 * Exposes an OpenAI-compatible HTTP endpoint on localhost that routes
 * requests to pooled upstream providers, rotating across their API keys and
 * failing over automatically when a key is rate-limited, dead, or empty.
 */
function createGateway(config) {
  let keys = (config.keys || []).map((k) => ({ ...k }));
  let providers = config.providers || [];
  let models = config.models || [];
  let modelQueue = config.modelQueue || [];
  let teams = config.teams || [];
  let cloudMemoryRecords = config.cloudMemoryRecords || [];
  let onMemoryWrite = config.onMemoryWrite || (() => {});
  let liveness = config.liveness || null;
  let settings = { ...config.settings };

  let onKeyUpdate = config.onKeyUpdate || (() => {});
  let onRequestLog = config.onRequestLog || (() => {});
  let onKeyStatusChange = config.onKeyStatusChange || (() => {});
  let onActiveKey = config.onActiveKey || (() => {});

  const logs = new CircularLog(MAX_LOG_ENTRIES);
  let server = null;
  let totalRequests = 0;
  let totalTokens = 0;
  let startTime = null;

  function getCooldownMs() {
    return (Number(settings.cooldown || settings.cd) || 60) * 1000;
  }

  function getRetries() {
    return settings.retries != null ? Math.max(0, Math.min(10, Number(settings.retries) || 0)) : 2;
  }

  /**
   * Authenticate the incoming request.
   *
   * Uses a constant-time comparison so the virtual key cannot be recovered
   * by timing the response.
   */
  function checkVirtualKey(req) {
    if (!settings.vkey) return true;
    const auth = req.headers['authorization'] || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token) return false;
    return safeEqual(token, String(settings.gatewayApiKey || ''));
  }

  function handleHealth(req, res) {
    jsonResponse(res, 200, {
      status: 'ok',
      service: 'mine-gateway',
      uptime: startTime ? Math.floor((Date.now() - startTime) / 1000) : 0,
      timestamp: new Date().toISOString(),
    });
  }

  function handleModels(req, res) {
    const modelList = [
      {
        id: 'mine/auto',
        object: 'model',
        created: 0,
        owned_by: 'Mine',
        context_window: null,
        description: 'Automatically uses your first favorite or discovered model',
      },
      ...(teams || []).filter((t) => t.enabled !== false).map((t) => ({
        id: 'mine/agent/' + (t.slug || t.id),
        object: 'model',
        created: 0,
        owned_by: 'Mine',
        context_window: null,
        description: 'Team: ' + (t.name || t.id),
      })),
      ...models.map((m) => {
        const provider = providers.find((p) => p.id === (m.providerId || m.provider));
        return {
          id: m.id,
          object: 'model',
          created: 0,
          owned_by: provider ? provider.name : 'unknown',
          context_window: m.ctx || null,
          free: !!m.free,
          pricing: m.pricing || null,
          discovered_at: m.discoveredAt || m.lastSeenAt || null,
        };
      }),
    ];

    jsonResponse(res, 200, { object: 'list', data: modelList });
  }

  function providerHasActiveKey(provider) {
    return keys.some(
      (k) =>
        k &&
        k.enabled !== false &&
        k.status !== 'DEAD' &&
        k.status !== 'CREDIT_EMPTY' &&
        (k.providerId === provider.id ||
          k.provider === provider.id ||
          matchProvider(k.providerId || k.provider, provider.id) ||
          matchProvider(k.providerId || k.provider, provider.name) ||
          matchProvider(k.providerId || k.provider, provider))
    );
  }

  function injectModelIdentity(messages, resolvedModel, providerName) {
    if (!Array.isArray(messages)) return;
    const instruction =
      'System context: The current active model executing this request is ' +
      resolvedModel +
      ' (provided via ' +
      providerName +
      '). If the user asks which model you are or which model they are using, ' +
      'accurately state this exact model name and provider.';

    const sysIdx = messages.findIndex((m) => m && m.role === 'system');
    if (sysIdx === -1) {
      messages.unshift({ role: 'system', content: instruction });
    } else {
      const existing = messages[sysIdx].content || '';
      if (!existing.includes('System context: The current active model executing this request is')) {
        messages[sysIdx] = {
          ...messages[sysIdx],
          content: (instruction + '\n\n' + existing).trim(),
        };
      }
    }
  }

  function updateKeyAfterSuccess(key, tokenCount, latency) {
    key.status = 'ACTIVE';
    key.usageToday = (key.usageToday || 0) + 1;
    key.usageTotal = (key.usageTotal || 0) + 1;
    key.totalTokens = (key.totalTokens || 0) + tokenCount;
    key.lastLatency = latency;
    key.lastUsed = Date.now();

    onKeyUpdate(key.id, {
      status: 'ACTIVE',
      usageToday: key.usageToday,
      usageTotal: key.usageTotal,
      totalTokens: key.totalTokens,
      lastLatency: key.lastLatency,
      lastUsed: key.lastUsed,
    });
  }

  function failKey(key, status, message, cooldownMs) {
    key.status = status;
    key.errors = (key.errors || 0) + 1;
    if (status === 'COOLDOWN') {
      key.cooldownUntil = Date.now() + cooldownMs;
    }
    onKeyStatusChange(key.id, status, message);
    onKeyUpdate(key.id, {
      status: key.status,
      cooldownUntil: key.cooldownUntil,
      errors: key.errors,
    });
  }

  async function handleProxy(req, res, pathname) {
    let lastErr = null;
    const agent = req.headers['x-mine-agent'] || req.headers['x-vault-agent'] || 'unknown';
    const requestStart = Date.now();

    let rawBody;
    try {
      rawBody = await readBody(req);
    } catch (err) {
      return errorResponse(res, 400, 'Failed to read request body');
    }

    let parsedBody;
    try {
      parsedBody = JSON.parse(rawBody.toString('utf8'));
    } catch (err) {
      return errorResponse(res, 400, 'Invalid JSON in request body');
    }

    const requestedModel = parsedBody.model;
    if (!requestedModel) {
      return errorResponse(res, 400, 'Missing "model" field in request body');
    }

    // Team routing: mine/team/<slug> runs the whole orchestration graph.
    if (typeof requestedModel === 'string' && (requestedModel.startsWith('mine/agent/') || requestedModel.startsWith('mine/team/'))) {
      const slug = requestedModel.startsWith('mine/agent/') ? requestedModel.slice('mine/agent/'.length) : requestedModel.slice('mine/team/'.length);
      const team = (teams || []).find((t) => t.slug === slug || t.id === slug);
      if (!team) {
        return errorResponse(res, 404, 'Unknown team: ' + slug);
      }
      const messages = Array.isArray(parsedBody.messages) ? parsedBody.messages : [];
      let userMsg = messages.length ? messages[messages.length - 1].content : (parsedBody.prompt || '');
      if (Array.isArray(userMsg)) userMsg = userMsg.map((p) => (p && (p.text || p.content)) || '').join('\n');
      const teamRunStream = !!parsedBody.stream;
      let teamRunTokens = 0;
      const writeTeamEvent = (event) => {
        if (!teamRunStream || res.writableEnded || res.destroyed) return;
        try {
          const payload = JSON.stringify(event);
          if (String(req.headers['x-mine-client'] || '') === 'team-ui') res.write('event: mine.progress\n' + 'data: ' + payload + '\n\n');
          else res.write(': mine.progress ' + payload + '\n\n');
        } catch (_) {}
      };
      if (teamRunStream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no', ...CORS_HEADERS });
        if (typeof res.flushHeaders === 'function') res.flushHeaders();
      }
      const callModel = async (modelId, prompt, opts) => {
        const meta = opts || {};
        const prov = resolveProvider(providers, modelId);
        if (!prov) throw new Error('No provider configured for model ' + modelId);
        const upstreamUrl = resolveUpstreamUrl(prov.url || prov.baseUrl || prov.base_url || '', '/v1/chat/completions', prov.id);
        const useStream = !!(teamRunStream && meta.stream);
        const bodyObj = {
          model: normalizeUpstreamModel(modelId.slice(modelId.indexOf('/') + 1), prov.id),
          messages: [{ role: 'user', content: prompt }],
          max_tokens: meta.maxTokens || 1024,
          temperature: meta.temperature == null ? 0.7 : meta.temperature,
          stream: useStream,
        };
        if (useStream) bodyObj.stream_options = { include_usage: true };
        const body = JSON.stringify(bodyObj);
        const maxRetries = getRetries();
        const cooldownMs = getCooldownMs();
        const triedKeyIds = new Set();
        let lastFailure = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          const key = selectBestUntried(keys, prov.id, cooldownMs, triedKeyIds);
          if (!key) break;
          triedKeyIds.add(key.id);
          const callStart = Date.now();
          const teamHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key.key };
          if (prov.id === 'anthropic') {
            teamHeaders['x-api-key'] = key.key;
            teamHeaders['anthropic-version'] = '2023-06-01';
          }

          let upstreamRes;
          try {
            upstreamRes = await proxyRequest(upstreamUrl, '/v1/chat/completions', teamHeaders, body, DEFAULT_TIMEOUT_MS, prov.id);
          } catch (_) {
            lastFailure = 'Provider connection failed or timed out';
            key.errors = (key.errors || 0) + 1;
            failKey(key, 'COOLDOWN', lastFailure, Math.min(cooldownMs, 30000));
            const failed = buildLog(callStart, agent, modelId, prov.id, key.id, keyLabel(key), 0, Date.now() - callStart, 502, lastFailure);
            Object.assign(failed, { kind: 'team-delegate', team: team.slug || team.id, nodeId: meta.nodeId || null, delegateId: meta.delegateId || null, role: meta.role || 'delegate' });
            logs.push(failed); onRequestLog(failed);
            continue;
          }

          const sc = upstreamRes.statusCode;
          const chunks = [];
          let responseText = '', usage = null, tail = '', rawBody = '';
          await new Promise((resolve, reject) => {
            upstreamRes.on('data', (chunk) => {
              if (!useStream) {
                chunks.push(chunk);
                return;
              }
              const partText = chunk.toString('utf8');
              if (sc < 200 || sc >= 300) rawBody += partText;
              const lines = (tail + partText).split('\n');
              tail = lines.pop();
              for (const line of lines) {
                const value = line.trim();
                if (!value.startsWith('data:')) continue;
                const data = value.slice(5).trim();
                if (!data || data === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(data);
                  if (parsed.usage) usage = parsed.usage;
                  const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
                  const textPart = delta && typeof delta.content === 'string' ? delta.content : '';
                  if (textPart) {
                    responseText += textPart;
                    writeTeamEvent({ type: 'delegate.delta', delegateId: meta.delegateId, nodeId: meta.nodeId, modelId, providerId: prov.id, text: textPart });
                  }
                } catch (_) {}
              }
            });
            upstreamRes.on('end', resolve);
            upstreamRes.on('error', reject);
          });

          if (!useStream) rawBody = Buffer.concat(chunks).toString('utf8');
          if (sc < 200 || sc >= 300) {
            if (sc === 429) {
              lastFailure = 'Provider rate limit reached (HTTP 429)';
              failKey(key, 'COOLDOWN', lastFailure, cooldownMs);
            } else if (sc === 401 || sc === 403) {
              lastFailure = 'Provider rejected this API key (HTTP ' + sc + ')';
              failKey(key, 'DEAD', lastFailure, cooldownMs);
            } else if (sc === 402) {
              lastFailure = 'Provider account has no available credit (HTTP 402)';
              failKey(key, 'CREDIT_EMPTY', lastFailure, cooldownMs);
            } else if (sc >= 500 || sc === 408) {
              lastFailure = 'Provider temporarily unavailable (HTTP ' + sc + ')';
              failKey(key, 'COOLDOWN', lastFailure, Math.min(cooldownMs, 30000));
            } else {
              lastFailure = sc === 404
                ? 'Selected model was not found by the provider (HTTP 404)'
                : 'Provider rejected the request (HTTP ' + sc + ')';
            }
            const failed = buildLog(callStart, agent, modelId, prov.id, key.id, keyLabel(key), 0, Date.now() - callStart, sc, lastFailure);
            Object.assign(failed, { kind: 'team-delegate', team: team.slug || team.id, nodeId: meta.nodeId || null, delegateId: meta.delegateId || null, role: meta.role || 'delegate' });
            logs.push(failed); onRequestLog(failed);
            if (sc === 404 || (sc >= 400 && sc < 500 && sc !== 408 && sc !== 429 && sc !== 402 && sc !== 401 && sc !== 403)) break;
            continue;
          }

          let promptTokens = Number(usage && (usage.prompt_tokens || usage.input_tokens)) || 0;
          let completionTokens = Number(usage && (usage.completion_tokens || usage.output_tokens)) || 0;
          let tokens = Number(usage && usage.total_tokens) || (promptTokens + completionTokens);
          let estimated = false;
          if (!useStream) {
            try {
              const parsed = JSON.parse(rawBody);
              const content = parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content;
              responseText = typeof content === 'string' ? content : Array.isArray(content) ? content.map((p) => p && (p.text || p.content) || '').join('') : '';
              usage = parsed.usage || null;
              promptTokens = Number(usage && (usage.prompt_tokens || usage.input_tokens)) || 0;
              completionTokens = Number(usage && (usage.completion_tokens || usage.output_tokens)) || 0;
              tokens = Number(usage && usage.total_tokens) || (promptTokens + completionTokens);
            } catch (_) {
              lastFailure = 'Provider returned an invalid completion response';
              break;
            }
          }
          if (!String(responseText || '').trim()) {
            lastFailure = 'Provider returned an empty completion';
            break;
          }
          if (!tokens) {
            promptTokens = promptTokens || Math.ceil(String(prompt || '').length / 4);
            completionTokens = completionTokens || Math.ceil(responseText.length / 4);
            tokens = promptTokens + completionTokens;
            estimated = true;
          }
          const latency = Date.now() - callStart;
          updateKeyAfterSuccess(key, tokens, latency);
          totalTokens += tokens;
          teamRunTokens += tokens;
          const entry = buildLog(callStart, agent, modelId, prov.id, key.id, keyLabel(key), tokens, latency, sc, null);
          Object.assign(entry, { kind: 'team-delegate', team: team.slug || team.id, nodeId: meta.nodeId || null, delegateId: meta.delegateId || null, role: meta.role || 'delegate', resolvedModel: modelId, promptTokens, completionTokens, usageEstimated: estimated });
          logs.push(entry);
          onRequestLog(entry);
          writeTeamEvent({ type: 'delegate.usage', delegateId: meta.delegateId, nodeId: meta.nodeId, modelId, providerId: prov.id, promptTokens, completionTokens, totalTokens: tokens, estimated, latency });
          return { text: responseText, keyId: key.id, providerId: prov.id, modelId, tokens, usage: { promptTokens, completionTokens, totalTokens: tokens, estimated } };
        }

        if (!lastFailure) lastFailure = 'No active API key is configured for provider ' + prov.id;
        if (triedKeyIds.size > 0 && triedKeyIds.size >= maxRetries + 1) {
          lastFailure += '; all retry attempts were exhausted';
        } else if (triedKeyIds.size > 0 && !keys.some((k) => k && k.enabled !== false && k.status !== 'DEAD' && k.status !== 'CREDIT_EMPTY' && (k.provider === prov.id || k.providerId === prov.id))) {
          lastFailure = 'No usable API keys remain for provider ' + prov.id;
        }
        throw new Error(lastFailure);
      };
      try {
        const out = await runTeam(team, userMsg, { callModel, liveness, settings, models, modelQueue, stream: teamRunStream, onEvent: writeTeamEvent, memory: { records: cloudMemoryRecords, save: onMemoryWrite } });
        const created = Math.floor(Date.now() / 1000);
        totalRequests++;
        const teamLog = buildLog(requestStart, agent, requestedModel, 'team:' + (team.slug || team.id), null, null, teamRunTokens, Date.now() - requestStart, 200, null);
        teamLog.kind = 'team-run';
        logs.push(teamLog);
        onRequestLog(teamLog);
        if (parsedBody.stream) {
          const chunk = { id: 'chatcmpl-team', object: 'chat.completion.chunk', created, model: requestedModel, choices: [{ index: 0, delta: { role: 'assistant', content: out.final }, finish_reason: null }] };
          const done = { id: 'chatcmpl-team', object: 'chat.completion.chunk', created, model: requestedModel, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
          const finalMeta = JSON.stringify({ runId: out.runId, team: team.slug || team.id, totalTokens: teamRunTokens, timings: out.timings });
          if (String(req.headers['x-mine-client'] || '') === 'team-ui') res.write('event: mine.final\n' + 'data: ' + finalMeta + '\n\n');
          else res.write(': mine.final ' + finalMeta + '\n\n');
          res.write('data: ' + JSON.stringify(chunk) + '\n\n');
          res.write('data: ' + JSON.stringify(done) + '\n\n');
          res.end('data: [DONE]\n\n');
          return;
        }
        const payload = { id: 'chatcmpl-team', object: 'chat.completion', created, model: requestedModel, choices: [{ index: 0, message: { role: 'assistant', content: out.final }, finish_reason: 'stop' }], usage: { total_tokens: teamRunTokens }, mine: { team: team.slug || team.id, runId: out.runId, nodes: out.nodes, timings: out.timings, totalTokens: teamRunTokens } };
        res.writeHead(200, { 'Content-Type': 'application/json', ...CORS_HEADERS });
        res.end(JSON.stringify(payload));
        return;
      } catch (err) {
        if (res.headersSent) {
          writeTeamEvent({ type: 'run.failed', error: err.message });
          if (!res.writableEnded) res.end('data: [DONE]\n\n');
          return;
        }
        return errorResponse(res, 500, 'Team run failed: ' + err.message);
      }
    }

    const automaticRequest = requestedModel === 'mine/auto' || requestedModel === 'auto';

    // Candidate list: one model when asked by name; for mine/auto the whole
    // queue (then any discovered model) so a dead / exhausted model falls
    // through to the next one.
    let candidates;
    if (automaticRequest) {
      candidates = automaticCandidates(models, modelQueue, keys);
      if (!candidates.length) {
        return errorResponse(
          res,
          503,
          'No models with active API keys available. Please add or enable an API key in API Keys.'
        );
      }
    } else {
      candidates = [null];
    }

    const originalMessages = Array.isArray(parsedBody.messages)
      ? JSON.parse(JSON.stringify(parsedBody.messages))
      : null;
    let lastFailure = { status: 503, message: 'All API keys exhausted after retries' };

    for (const selectedModel of candidates) {
      const outcome = await attemptModel(selectedModel);
      if (outcome.done) return;
      lastFailure = outcome;
      if (!automaticRequest) break;
    }

    return errorResponse(res, lastFailure.status || 503, lastFailure.message);

    async function attemptModel(selectedModel) {
      const routingModel = selectedModel ? selectedModel.id : requestedModel;

      const provider = resolveProvider(providers, routingModel);
      if (!provider) {
        return { done: false, status: 400, message: 'No provider found for model: ' + routingModel };
      }

      const provName = provider.name || provider.id;

      if (!providerHasActiveKey(provider)) {
        const logEntry = buildLog(requestStart, agent, requestedModel, provider.id, null, null, 0, 0, 503, 'No active keys');
        logs.push(logEntry);
        onRequestLog(logEntry);
        return {
          done: false,
          status: 503,
          message: 'No active API key found for provider: ' + provName + '. Please add an API key.',
        };
      }

      const upstreamModel = normalizeUpstreamModel(selectedModel && selectedModel.rawId ? selectedModel.rawId : stripProviderPrefix(routingModel), provider.id || provider.name);
      const resolvedModel =
        selectedModel && (selectedModel.name || selectedModel.id)
          ? selectedModel.name || selectedModel.id
          : routingModel || upstreamModel;
      const providerName = provider.name || provider.id;
      const providerId = provider.id || provName;

      const body = { ...parsedBody };
      if (originalMessages) {
        body.messages = JSON.parse(JSON.stringify(originalMessages));
        if (settings.injectIdentity !== false) injectModelIdentity(body.messages, resolvedModel, providerName);
      }
      body.model = upstreamModel;

      const upstreamBody = Buffer.from(JSON.stringify(body), 'utf8');
      const isStreaming = !!body.stream;
      const maxRetries = getRetries();
      const cooldownMs = getCooldownMs();
      const timeout = settings.timeout ? Number(settings.timeout) * 1000 : DEFAULT_TIMEOUT_MS;

      const triedKeyIds = new Set();

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const key = selectBestUntried(keys, provider.id, cooldownMs, triedKeyIds);
        if (!key) {
          const logEntry = buildLog(requestStart, agent, requestedModel, provider.id, null, null, 0, 0, 503, 'No available keys');
          logs.push(logEntry);
          onRequestLog(logEntry);
          return { done: false, status: 503, message: 'No available API keys for provider: ' + provName };
        }

        triedKeyIds.add(key.id);

        onActiveKey({
          keyId: key.id,
          providerId: provider.id,
          model: requestedModel,
          keyLabel: keyLabel(key),
          timestamp: Date.now(),
        });

        // The client's Authorization header is replaced with the selected
        // account's own key and never forwarded as-is.
        const upstreamHeaders = {};
        for (const [h, v] of Object.entries(req.headers)) {
          const lower = h.toLowerCase();
          if (lower === 'host' || lower === 'x-mine-agent' || lower === 'x-vault-agent') continue;
          if (lower === 'authorization' || lower === 'x-api-key') continue;
          if (HOP_HEADERS.has(lower) || lower.startsWith('x-vercel-') || lower.startsWith('x-forwarded-')) continue;
          upstreamHeaders[lower] = v;
        }
        upstreamHeaders['authorization'] = 'Bearer ' + key.key;
        if (provider.id === 'anthropic') {
          upstreamHeaders['x-api-key'] = key.key;
          if (!upstreamHeaders['anthropic-version']) upstreamHeaders['anthropic-version'] = '2023-06-01';
        }
        upstreamHeaders['content-type'] = 'application/json';

        let upstreamRes;
        try {
          const target = resolveUpstreamUrl(provider.url || provider.baseUrl, pathname, provider.id || provider.name);
          upstreamRes = await proxyRequest(target, pathname, upstreamHeaders, upstreamBody, timeout, provider.id || provider.name);
        } catch (err) {
          const latency = Date.now() - requestStart;
          key.errors = (key.errors || 0) + 1;
          const logEntry = buildLog(requestStart, agent, requestedModel, provider.id, key.id, keyLabel(key), 0, latency, 502, err.message);
          logs.push(logEntry);
          onRequestLog(logEntry);
          lastErr = err.message;
          continue;
        }

        const upstreamStatus = upstreamRes.statusCode;

        if (upstreamStatus === 429) {
          failKey(key, 'COOLDOWN', 'Rate limited (429)', cooldownMs);
          logFail(provider.id, key, 429, 'Rate limited');
          upstreamRes.resume();
          continue;
        }
        if (upstreamStatus === 401 || upstreamStatus === 403) {
          failKey(key, 'DEAD', 'Unauthorized (' + upstreamStatus + ')', cooldownMs);
          logFail(provider.id, key, upstreamStatus, 'Unauthorized');
          upstreamRes.resume();
          continue;
        }
        if (upstreamStatus === 402) {
          failKey(key, 'CREDIT_EMPTY', 'Payment required (402)', cooldownMs);
          logFail(provider.id, key, 402, 'Payment required');
          upstreamRes.resume();
          continue;
        }
        // For mine/auto, a model that is gone (404) or a provider outage (5xx)
        // falls through to the next model in the queue.
        if (automaticRequest && (upstreamStatus === 404 || upstreamStatus >= 500)) {
          logFail(provider.id, key, upstreamStatus, 'Upstream ' + upstreamStatus + ', trying next model');
          upstreamRes.resume();
          return { done: false, status: 502, message: 'Upstream ' + upstreamStatus + ' from ' + provName };
        }

        const responseHeaders = { ...CORS_HEADERS };
        for (const [h, v] of Object.entries(upstreamRes.headers)) {
          const lower = h.toLowerCase();
          if (lower.startsWith('access-control-')) continue;
          if (HOP_HEADERS.has(lower) || lower === 'set-cookie') continue;
          responseHeaders[lower] = v;
        }
        responseHeaders['x-resolved-model'] = String(resolvedModel);
        responseHeaders['x-provider'] = String(providerId);

        if (!isStreaming) {
          const bodyChunks = [];
          upstreamRes.on('data', (chunk) => bodyChunks.push(chunk));
          await new Promise((resolve, reject) => {
            upstreamRes.on('end', resolve);
            upstreamRes.on('error', reject);
          });

          let respBuf = Buffer.concat(bodyChunks);
          const latency = Date.now() - requestStart;
          let tokenCount = 0;

          try {
            const respBody = JSON.parse(respBuf.toString('utf8'));
            if (respBody.usage && respBody.usage.total_tokens) tokenCount = respBody.usage.total_tokens;
            if (upstreamStatus >= 200 && upstreamStatus < 300 && respBody && typeof respBody === 'object') {
              respBody.resolvedModel = resolvedModel;
              respBody.provider = providerId;
              respBuf = Buffer.from(JSON.stringify(respBody), 'utf8');
            }
          } catch (e) {
            /* Non-JSON upstream body is fine. */
          }

          responseHeaders['content-length'] = String(respBuf.length);
          res.writeHead(upstreamStatus, responseHeaders);
          res.end(respBuf);

          if (upstreamStatus < 400) updateKeyAfterSuccess(key, tokenCount, latency);
          totalRequests++;
          totalTokens += tokenCount;

          const logEntry = buildLog(requestStart, agent, requestedModel, provider.id, key.id, keyLabel(key), tokenCount, latency, upstreamStatus, upstreamStatus >= 400 ? 'Upstream error' : null);
          logEntry.resolvedModel = resolvedModel;
          logs.push(logEntry);
          onRequestLog(logEntry);
        } else {
          let lastData = '';
          let tokenCount = 0;
          let tail = '';
          if (!responseHeaders['content-type']) responseHeaders['content-type'] = 'text/event-stream; charset=utf-8';
          responseHeaders['cache-control'] = 'no-cache, no-transform';
          responseHeaders['x-accel-buffering'] = 'no';
          res.writeHead(upstreamStatus, responseHeaders);
          if (typeof res.flushHeaders === 'function') res.flushHeaders();

          upstreamRes.on('data', (chunk) => {
            res.write(chunk);
            const text = tail + chunk.toString('utf8');
            const lines = text.split('\n');
            tail = lines.pop();
            for (const line of lines) {
              const l = line.trim();
              if (l.startsWith('data: ') && l !== 'data: [DONE]') lastData = l.substring(6);
            }
          });

          await new Promise((resolve, reject) => {
            upstreamRes.on('end', resolve);
            upstreamRes.on('error', reject);
          });

          res.end();

          const latency = Date.now() - requestStart;
          try {
            const parsed = JSON.parse(lastData);
            if (parsed.usage && parsed.usage.total_tokens) tokenCount = parsed.usage.total_tokens;
          } catch (e) {
            /* Providers commonly omit usage in streams. */
          }

          if (upstreamStatus < 400) updateKeyAfterSuccess(key, tokenCount, latency);
          totalRequests++;
          totalTokens += tokenCount;

          const logEntry = buildLog(requestStart, agent, requestedModel, provider.id, key.id, keyLabel(key), tokenCount, latency, upstreamStatus, upstreamStatus >= 400 ? 'Upstream error' : null);
          logEntry.resolvedModel = resolvedModel;
          logs.push(logEntry);
          onRequestLog(logEntry);
        }

        return { done: true };
      }

      const latency = Date.now() - requestStart;
      const logEntry = buildLog(requestStart, agent, requestedModel, provider.id, null, null, 0, latency, 503, 'All retries exhausted' + (lastErr ? ': ' + lastErr : ''));
      logs.push(logEntry);
      onRequestLog(logEntry);
      return { done: false, status: 503, message: 'All API keys exhausted after retries' + (lastErr ? ' (' + lastErr + ')' : '') };
    }

    function logFail(providerId, key, status, msg) {
      const logEntry = buildLog(requestStart, agent, requestedModel, providerId, key.id, keyLabel(key), 0, Date.now() - requestStart, status, msg);
      logs.push(logEntry);
      onRequestLog(logEntry);
    }
  }

  /**
   * Handle one request. Returns a promise that settles once the response is
   * fully written, so a serverless runtime does not freeze mid-stream.
   */
  async function handleRequest(req, res, pathOverride) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      return res.end();
    }

    const parsedUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    const pathname = pathOverride || parsedUrl.pathname;

    if (pathname === '/health' && req.method === 'GET') {
      return handleHealth(req, res);
    }

    if (pathname.startsWith('/v1')) {
      if (!checkVirtualKey(req)) {
        return errorResponse(res, 401, 'Unauthorized: invalid or missing virtual key', 'authentication_error');
      }
    }

    if (pathname === '/v1/models' && req.method === 'GET') {
      return handleModels(req, res);
    }

    if (PROXY_PATHS.includes(pathname) && req.method === 'POST') {
      try {
        await handleProxy(req, res, pathname);
      } catch (err) {
        if (!res.headersSent) {
          errorResponse(res, 500, 'Internal gateway error: ' + err.message);
        } else {
          try { res.end(); } catch (_) {}
        }
      }
      return;
    }

    errorResponse(res, 404, 'Not found');
  }

  function start() {
    return new Promise((resolve, reject) => {
      const host = settings.host || '127.0.0.1';
      const port = settings.port || 4444;

      server = require('http').createServer((req, res) => { handleRequest(req, res); });
      server.on('error', (err) => reject(err));

      server.listen(port, host, () => {
        startTime = Date.now();
        resolve({ host, port, url: 'http://' + host + ':' + port });
      });

      server.keepAliveTimeout = 65000;
      server.headersTimeout = 66000;
    });
  }

  function stop() {
    return new Promise((resolve, reject) => {
      if (!server) return resolve();
      server.close((err) => {
        server = null;
        startTime = null;
        if (err) reject(err);
        else resolve();
      });
      setTimeout(() => {
        if (server && server.closeAllConnections) server.closeAllConnections();
      }, 5000);
    });
  }

  function getStats() {
    const activeKeys = keys.filter((k) => k.enabled !== false && k.status === 'ACTIVE').length;
    const cooldownKeys = keys.filter((k) => k.status === 'COOLDOWN').length;
    const deadKeys = keys.filter((k) => k.status === 'DEAD').length;
    const emptyKeys = keys.filter((k) => k.status === 'CREDIT_EMPTY').length;

    return {
      uptime: startTime ? Math.floor((Date.now() - startTime) / 1000) : 0,
      totalRequests,
      totalTokens,
      keys: {
        total: keys.length,
        active: activeKeys,
        cooldown: cooldownKeys,
        dead: deadKeys,
        creditEmpty: emptyKeys,
      },
      providers: providers.length,
      models: models.length,
    };
  }

  function getLogs() {
    return logs.all();
  }

  function updateConfig(newConfig) {
    if (newConfig.keys) {
      const existingMap = new Map(keys.map((k) => [k.id, k]));
      keys = newConfig.keys.map((k) => {
        const existing = existingMap.get(k.id);
        if (existing) {
          return {
            ...existing,
            key: k.key,
            providerId: k.providerId,
            provider: k.provider || existing.provider,
            label: k.label || existing.label,
            enabled: k.enabled !== false,
            status: k.status !== undefined ? k.status : existing.status,
          };
        }
        return { ...k };
      });
    }
    if (newConfig.providers) providers = newConfig.providers;
    if (Array.isArray(newConfig.models)) models = newConfig.models;
    if (Array.isArray(newConfig.modelQueue)) modelQueue = newConfig.modelQueue;
    if (Array.isArray(newConfig.teams)) teams = newConfig.teams;
    if (newConfig.settings) settings = { ...settings, ...newConfig.settings };
    if (newConfig.onKeyUpdate) onKeyUpdate = newConfig.onKeyUpdate;
    if (newConfig.onRequestLog) onRequestLog = newConfig.onRequestLog;
    if (newConfig.onKeyStatusChange) onKeyStatusChange = newConfig.onKeyStatusChange;
    if (newConfig.onActiveKey) onActiveKey = newConfig.onActiveKey;
  }

  function markStarted(ts) {
    startTime = ts || Date.now();
  }

  return { start, stop, getStats, getLogs, updateConfig, handleRequest, markStarted };
}

module.exports = { createGateway };
module.exports.__internal = {
  chooseAutomaticModel,
  resolveProvider,
  stripProviderPrefix,
  getModelProvider: require('./providers').getModelProvider,
  resolveUpstreamUrl,
  matchProvider: require('./providers').matchProvider,
  normalizeProviderId: require('./providers').normalizeProviderId,
  selectBestUntried,
};
