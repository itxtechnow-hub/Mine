'use strict';

/**
 * Provider model-discovery endpoints.
 *
 * Keyed by provider id. Every entry is the full `/models` URL so that the
 * proxy base path is never guessed at runtime.
 */
const BUILTIN_MODELS_URL = {
  openai: 'https://api.openai.com/v1/models',
  anthropic: 'https://api.anthropic.com/v1/models',
  groq: 'https://api.groq.com/openai/v1/models',
  xai: 'https://api.x.ai/v1/models',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai/models',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/models',
  perplexity: 'https://api.perplexity.ai/v1/models',
  openrouter: 'https://openrouter.ai/api/v1/models',
  cerebras: 'https://api.cerebras.ai/v1/models',
  deepseek: 'https://api.deepseek.com/v1/models',
  deepinfra: 'https://api.deepinfra.com/v1/openai/models',
  fireworks: 'https://api.fireworks.ai/inference/v1/models',
  together: 'https://api.together.xyz/v1/models',
  mistral: 'https://api.mistral.ai/v1/models',
  codestral: 'https://codestral.mistral.ai/v1/models',
  cohere: 'https://api.cohere.ai/compatibility/v1/models',
  sambanova: 'https://api.sambanova.ai/v1/models',
  siliconflow: 'https://api.siliconflow.com/v1/models',
  huggingface: 'https://router.huggingface.co/v1/models',
  novita: 'https://api.novita.ai/v3/openai/models',
  hyperbolic: 'https://api.hyperbolic.xyz/v1/models',
  featherless: 'https://api.featherless.ai/v1/models',
  moonshot: 'https://api.moonshot.ai/v1/models',
  minimax: 'https://api.minimax.io/v1/models',
  nvidia: 'https://integrate.api.nvidia.com/v1/models',
  nebius: 'https://api.studio.nebius.ai/v1/models',
  replicate: 'https://api.replicate.com/v1/models',
  lepton: 'https://api.lepton.ai/v1/models',
  anyscale: 'https://api.endpoints.anyscale.com/v1/models',
  baseten: 'https://inference.baseten.co/v1/models',
  stepfun: 'https://api.stepfun.com/v1/models',
  dashscope: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models',
  zai: 'https://api.z.ai/api/paas/v4/models',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4/models',
  chutes: 'https://llm.chutes.ai/v1/models',
  aimlapi: 'https://api.aimlapi.com/v1/models',
  lambda: 'https://api.lambdalabs.com/v1/models',
  friendli: 'https://api.friendli.ai/serverless/v1/models',
  predibase: 'https://serving.predibase.com/v1/models',
  ollama: 'http://127.0.0.1:11434/v1/models',
  lmstudio: 'http://127.0.0.1:1234/v1/models',
  llamacpp: 'http://127.0.0.1:8080/v1/models',
  vllm: 'http://127.0.0.1:8000/v1/models',
  localai: 'http://127.0.0.1:8080/v1/models',
  jan: 'http://127.0.0.1:1337/v1/models',
  tabby: 'http://127.0.0.1:8080/v1/models',
  koboldcpp: 'http://127.0.0.1:5001/v1/models',
  aphrodite: 'http://127.0.0.1:2242/v1/models',
  tgi: 'http://127.0.0.1:3000/v1/models',
  opencode: 'https://opencode.ai/zen/v1/models',
  'opencode-go': 'https://opencode.ai/zen/go/v1/models',
  '302ai': 'https://api.302.ai/v1/models',
  cortecs: 'https://api.cortecs.ai/v1/models',
  digitalocean: 'https://inference.do-ai.run/v1/models',
  edenai: 'https://api.edenai.run/v3/models',
  frogbot: 'https://api.frogbot.ai/v1/models',
  gmi: 'https://api.gmi-serving.com/v1/models',
  helicone: 'https://ai-gateway.helicone.ai/v1/models',
  ionet: 'https://api.intelligence.io.solutions/api/v1/models',
  'ollama-cloud': 'https://ollama.com/v1/models',
  llmgateway: 'https://api.llmgateway.io/v1/models',
  stackit: 'https://api.openai-compat.model-serving.eu01.onstackit.cloud/v1/models',
  ovhcloud: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/models',
  scaleway: 'https://api.scaleway.ai/v1/models',
  scx: 'https://api.scx.ai/v1/models',
  venice: 'https://api.venice.ai/api/v1/models',
  vercel: 'https://ai-gateway.vercel.sh/v1/models',
  zenmux: 'https://zenmux.ai/api/v1/models',
  targon: 'https://api.targon.com/v1/models',
  inferencenet: 'https://api.inference.net/v1/models',
  electronhub: 'https://api.electronhub.top/v1/models',
  requesty: 'https://router.requesty.ai/v1/models',
  kluster: 'https://api.kluster.ai/v1/models',
  arliai: 'https://api.arliai.com/v1/models',
  typhoon: 'https://api.opentyphoon.ai/v1/models',
  pollinations: 'https://text.pollinations.ai/openai/models',
  llm7: 'https://api.llm7.io/v1/models',
};

/**
 * API-key prefix -> provider id.
 *
 * Longer prefixes are checked first so `sk-ant-` wins over `sk-`.
 */
const KEY_PREFIX_MAP = {
  'sk-ant-': 'anthropic',
  'sk-proj-': 'openai',
  'sk-or-': 'openrouter',
  'sk-': 'openai',
  'gsk_': 'groq',
  'xai-': 'xai',
  AIza: 'gemini',
  AI: 'gemini',
  'csk-': 'cerebras',
  'hf_': 'huggingface',
  'fw_': 'fireworks',
  'cpk_': 'chutes',
  'pplx-': 'perplexity',
};

const SORTED_PREFIXES = Object.keys(KEY_PREFIX_MAP).sort((a, b) => b.length - a.length);

function detectProviderFromPrefix(apiKey, customProviders) {
  if (typeof apiKey !== 'string' || !apiKey) return 'unknown';

  const customs = Array.isArray(customProviders) ? customProviders : [];
  for (const p of customs) {
    if (!p) continue;
    const prefix = p.prefix || p.keyPrefix;
    if (prefix && apiKey.startsWith(prefix)) {
      return p.id || p.name;
    }
  }

  for (const prefix of SORTED_PREFIXES) {
    if (apiKey.startsWith(prefix)) {
      return KEY_PREFIX_MAP[prefix];
    }
  }

  return 'unknown';
}

/**
 * Resolve the `/models` endpoint for a provider.
 * Returns null when the provider has no known endpoint.
 */
function getProviderModelsUrl(provider, customProviders, storedProviders) {
  // Custom overrides (including edited built-in providers) take precedence.
  const allKnown = [
    ...(customProviders || []),
    ...(storedProviders || []),
  ];
  const custom = allKnown.find((p) => p && (p.id || p.name) === provider);
  if (custom && (custom.baseUrl || custom.url)) {
    const u = (custom.baseUrl || custom.url).replace(/\/+$/, '');
    if (u.endsWith('/models')) return u;
    if (/\/v\d+(beta)?$/.test(u)) return u + '/models';
    return u + '/v1/models';
  }

  if (BUILTIN_MODELS_URL[provider]) return BUILTIN_MODELS_URL[provider];

  return null;
}

module.exports = {
  BUILTIN_MODELS_URL,
  KEY_PREFIX_MAP,
  detectProviderFromPrefix,
  getProviderModelsUrl,
};
