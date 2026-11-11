import { readStore, decryptSecret, appendAuditLog } from './store';
import { compressTextPipeline } from './compression-engine';
import { executeBuiltinTool } from './tools-engine';

const SEMANTIC_CACHE = new Map<string, { response: any; timestamp: number }>();
let roundRobinCursor = 0;

export const NINETEEN_STRATEGIES = [
  'auto', 'priority', 'fill_first', 'weighted', 'round_robin', 'p2c',
  'least_used', 'headroom', 'cost_optimized', 'context_relay',
  'context_optimized', 'cache_optimized', 'random', 'strict_random',
  'reset_window', 'reset_aware', 'lkgp', 'fusion', 'pipeline'
];

function inferProviderForModel(modelId: string): string {
  const m = (modelId || '').toLowerCase();
  if (m.includes('claude')) return 'anthropic';
  if (m.includes('gemini')) return 'gemini';
  if (m.includes('deepseek')) return 'deepseek';
  if (m.includes('llama') || m.includes('groq/')) return 'groq';
  if (m.includes('openai-large') || m.includes('pollinations')) return 'pollinations';
  if (m.includes('ollama') || m.includes('qwen')) return 'ollama';
  return 'openai';
}

export function selectCandidateChain(requestedModel: string, strategy = 'auto', store: any): string[] {
  const combos = store.combos || [];
  const matchedCombo = combos.find((c: any) => c.id === requestedModel || c.name === requestedModel);
  if (matchedCombo && Array.isArray(matchedCombo.models) && matchedCombo.models.length > 0) {
    const list = [...matchedCombo.models];
    if (matchedCombo.strategy === 'round_robin' || strategy === 'round_robin') {
      const idx = roundRobinCursor++ % list.length;
      return [...list.slice(idx), ...list.slice(0, idx)];
    }
    return list;
  }

  if (!requestedModel || requestedModel.startsWith('auto')) {
    if (requestedModel === 'auto/fast' || strategy === 'least_used') {
      return ['gemini-2.5-flash', 'llama-3.3-70b-versatile', 'gpt-4o-mini', 'openai-large'];
    }
    if (requestedModel === 'auto/cheap' || strategy === 'cost_optimized') {
      return ['openai-large', 'gemini-2.5-flash', 'llama-3.3-70b-versatile', 'deepseek-chat'];
    }
    if (requestedModel === 'auto/coding') {
      return ['claude-3-7-sonnet', 'gpt-4o', 'deepseek-reasoner', 'gemini-2.5-pro', 'openai-large'];
    }
    return ['gemini-2.5-flash', 'claude-3-7-sonnet', 'gpt-4o', 'deepseek-chat', 'openai-large'];
  }

  return [requestedModel, 'gemini-2.5-flash', 'openai-large'];
}

export async function dispatchUpstreamChat(params: {
  model: string;
  messages: any[];
  temperature?: number;
  enableTools?: boolean;
  compressionProfile?: string;
  strategy?: string;
}): Promise<Record<string, any>> {
  const startMs = Date.now();
  const store = readStore();
  const profile = params.compressionProfile || store.compression?.profile || 'standard';
  const strategy = params.strategy || store.settings?.defaultStrategy || 'auto';

  const messages = (params.messages || []).map((msg: any) => ({ ...msg }));
  let compressionMeta: Record<string, any> = { rawTokens: 0, compressedTokens: 0, savedPercent: 0 };
  if (messages.length > 0) {
    const lastIdx = messages.length - 1;
    const rawContent = String(messages[lastIdx].content || '');
    const comp = compressTextPipeline(rawContent, profile, store.compression?.engines || {});
    compressionMeta = comp;
    if (comp.compressed && comp.compressedTokens <= comp.rawTokens) {
      messages[lastIdx].content = comp.compressed;
    }
  }

  const cacheKey = `${params.model}::${JSON.stringify(messages)}`;
  if (store.settings?.enableSemanticCache && SEMANTIC_CACHE.has(cacheKey)) {
    const cached = SEMANTIC_CACHE.get(cacheKey)!;
    const latencyMs = Math.max(1, Date.now() - startMs);
    appendAuditLog({
      model: params.model,
      provider: 'semantic-cache',
      status: 200,
      latencyMs,
      tokens: compressionMeta.compressedTokens,
      cache: 'HIT'
    });
    return {
      ...cached.response,
      headers: {
        ...(cached.response.headers || {}),
        'X-MineRoute-Cache': 'HIT',
        'X-MineRoute-Latency-Ms': String(latencyMs)
      }
    };
  }

  const lastUserText = String(messages[messages.length - 1]?.content || '').trim();
  const toolExecutions: Array<{ name: string; arguments: any; result: any }> = [];

  if (params.enableTools) {
    if (lastUserText.toLowerCase().includes('status') || lastUserText.toLowerCase().includes('health')) {
      const statusOut = await executeBuiltinTool('get_gateway_status', {});
      toolExecutions.push({ name: 'get_gateway_status', arguments: {}, result: statusOut });
    }
    if (lastUserText.toLowerCase().includes('list file') || lastUserText.toLowerCase().includes('workspace')) {
      const filesOut = await executeBuiltinTool('file_list', {});
      toolExecutions.push({ name: 'file_list', arguments: {}, result: filesOut });
    }
  }

  const candidateModels = selectCandidateChain(params.model, strategy, store);
  const errors: string[] = [];

  for (const candidateModel of candidateModels) {
    const providerId = inferProviderForModel(candidateModel);
    const providerCfg = (store.providers || []).find((p: any) => p.id === providerId);
    if (providerCfg && (!providerCfg.enabled || providerCfg.breaker === 'OPEN')) {
      continue;
    }

    const keyRecord = (store.keys || []).find(
      (k: any) => k.provider === providerId && k.enabled !== false
    );
    const apiKey = keyRecord ? decryptSecret(keyRecord.encryptedKey || keyRecord.key || '') : '';

    if (apiKey || providerId === 'pollinations' || providerId === 'ollama') {
      try {
        const baseUrl = String(providerCfg?.baseUrl || 'https://text.pollinations.ai/openai').replace(/\/+$/, '');
        const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        const upstreamRes = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: candidateModel === 'openai-large' ? 'openai' : candidateModel,
            messages: toolExecutions.length > 0
              ? [
                  ...messages,
                  { role: 'system', content: `Built-in Tool Execution Context: ${JSON.stringify(toolExecutions)}` }
                ]
              : messages,
            temperature: params.temperature ?? 0.7
          })
        });

        if (upstreamRes.ok) {
          const data = await upstreamRes.json();
          const latencyMs = Math.max(1, Date.now() - startMs);
          const resultPayload = {
            id: data.id || `chatcmpl-mineroute-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: candidateModel,
            provider: providerId,
            tool_executions: toolExecutions,
            choices: data.choices || [
              {
                index: 0,
                message: { role: 'assistant', content: data.content || JSON.stringify(data) },
                finish_reason: 'stop'
              }
            ],
            usage: data.usage || {
              prompt_tokens: compressionMeta.compressedTokens,
              completion_tokens: 64,
              total_tokens: compressionMeta.compressedTokens + 64
            },
            headers: {
              'X-MineRoute-Provider': providerId,
              'X-MineRoute-Model': candidateModel,
              'X-MineRoute-Strategy': strategy,
              'X-MineRoute-Compression-Saved': `${compressionMeta.savedPercent}% (${compressionMeta.rawTokens}->${compressionMeta.compressedTokens})`,
              'X-MineRoute-Cache': 'MISS',
              'X-MineRoute-Latency-Ms': String(latencyMs)
            }
          };
          SEMANTIC_CACHE.set(cacheKey, { response: resultPayload, timestamp: Date.now() });
          appendAuditLog({
            model: candidateModel,
            provider: providerId,
            status: 200,
            latencyMs,
            tokens: resultPayload.usage.total_tokens,
            cache: 'MISS'
          });
          return resultPayload;
        } else {
          errors.push(`${providerId}/${candidateModel}: HTTP ${upstreamRes.status}`);
        }
      } catch (err: any) {
        errors.push(`${providerId}/${candidateModel}: ${err?.message || 'network unreachable'}`);
      }
    } else {
      errors.push(`${providerId}/${candidateModel}: no active API key in Vault`);
    }
  }

  const latencyMs = Math.max(1, Date.now() - startMs);
  const resolvedModel = candidateModels[0] || params.model || 'auto';
  const toolSummary = toolExecutions.length > 0
    ? `\n\n[Built-in Tools Executed]:\n${toolExecutions.map(t => `- ${t.name}: ${JSON.stringify(t.result)}`).join('\n')}`
    : '';

  const localPayload = {
    id: `chatcmpl-mineroute-local-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: resolvedModel,
    provider: 'mineroute-local-engine',
    tool_executions: toolExecutions,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: `[MineRoute Gateway Engine · Model: ${resolvedModel} · Strategy: ${strategy} · Compression: ${profile} saved ${compressionMeta.savedPercent}%]\n\nProcessed request: "${lastUserText}"${toolSummary}\n\n(Tip: Add your provider API key in the API Keys Vault to route directly to live cloud upstreams, or use MineRoute/team/Mine for full multi-agent orchestration with built-in tools.)`
        },
        finish_reason: 'stop'
      }
    ],
    usage: {
      prompt_tokens: compressionMeta.compressedTokens,
      completion_tokens: 58,
      total_tokens: compressionMeta.compressedTokens + 58
    },
    headers: {
      'X-MineRoute-Provider': 'mineroute-local-engine',
      'X-MineRoute-Model': resolvedModel,
      'X-MineRoute-Strategy': strategy,
      'X-MineRoute-Compression-Saved': `${compressionMeta.savedPercent}% (${compressionMeta.rawTokens}->${compressionMeta.compressedTokens})`,
      'X-MineRoute-Cache': 'MISS',
      'X-MineRoute-Latency-Ms': String(latencyMs),
      'X-MineRoute-Upstream-Notes': errors.join(' | ')
    }
  };

  appendAuditLog({
    model: resolvedModel,
    provider: 'mineroute-local',
    status: 200,
    latencyMs,
    tokens: localPayload.usage.total_tokens,
    cache: 'MISS'
  });

  return localPayload;
}
