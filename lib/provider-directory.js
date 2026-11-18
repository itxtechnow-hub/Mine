const BUILTIN_PROVIDERS = [
  // Top Frontier & Major Clouds
  {id:'anthropic',name:'Anthropic Claude',url:'https://api.anthropic.com/v1',pre:'sk-ant-',free:0,reset:'Pay as you go',cat:'Paid',env:'ANTHROPIC_API_KEY'},
  {id:'openai',name:'OpenAI',url:'https://api.openai.com/v1',pre:'sk-proj-',free:0,reset:'Pay as you go',cat:'Paid',env:'OPENAI_API_KEY'},
  {id:'gemini',name:'Google Gemini',url:'https://generativelanguage.googleapis.com/v1beta/openai',pre:'AIza',free:1,reset:'Daily, Pacific',cat:'Free',env:'GEMINI_API_KEY'},
  {id:'groq',name:'Groq (Ultra-Fast LPU)',url:'https://api.groq.com/openai/v1',pre:'gsk_',free:1,reset:'Daily, UTC',cat:'Free',env:'GROQ_API_KEY'},
  {id:'cerebras',name:'Cerebras (Fastest Wafer)',url:'https://api.cerebras.ai/v1',pre:'csk-',free:1,reset:'Daily, UTC',cat:'Free',env:'CEREBRAS_API_KEY'},
  {id:'openrouter',name:'OpenRouter',url:'https://openrouter.ai/api/v1',pre:'sk-or-',free:1,reset:'Daily, UTC',cat:'Free',env:'OPENROUTER_API_KEY'},
  {id:'deepseek',name:'DeepSeek',url:'https://api.deepseek.com/v1',pre:'sk-',free:0,reset:'Pay as you go',cat:'Paid',env:'DEEPSEEK_API_KEY'},
  {id:'xai',name:'xAI (Grok)',url:'https://api.x.ai/v1',pre:'xai-',free:0,reset:'Pay as you go',cat:'Paid',env:'XAI_API_KEY'},
  {id:'mistral',name:'Mistral AI',url:'https://api.mistral.ai/v1',pre:'',free:1,reset:'Monthly',cat:'Free',env:'MISTRAL_API_KEY'},
  {id:'codestral',name:'Mistral Codestral',url:'https://codestral.mistral.ai/v1',pre:'',free:1,reset:'Monthly',cat:'Free',env:'CODESTRAL_API_KEY'},
  {id:'cohere',name:'Cohere (Command R+)',url:'https://api.cohere.ai/compatibility/v1',pre:'',free:1,reset:'Monthly',cat:'Free',env:'COHERE_API_KEY'},
  {id:'coarena',name:'Coarena AI (Daily Free Models)',url:'https://coarena.ai/api/v1',pre:'',free:1,reset:'Daily, UTC',cat:'Free',env:'COARENA_API_KEY'},
  {id:'cloudflare-workers-ai',name:'Cloudflare Workers AI',url:'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1',pre:'',free:1,reset:'Daily, UTC (10,000 Neurons)',cat:'Free',env:'CLOUDFLARE_API_TOKEN'},
  {id:'perplexity',name:'Perplexity AI',url:'https://api.perplexity.ai',pre:'pplx-',free:0,reset:'Pay as you go',cat:'Paid',env:'PERPLEXITY_API_KEY'},

  // Fast Inference & Serverless Clouds
  {id:'together',name:'Together AI',url:'https://api.together.xyz/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'TOGETHER_API_KEY'},
  {id:'fireworks',name:'Fireworks AI',url:'https://api.fireworks.ai/inference/v1',pre:'fw_',free:0,reset:'Pay as you go',cat:'Paid',env:'FIREWORKS_API_KEY'},
  {id:'deepinfra',name:'Deep Infra',url:'https://api.deepinfra.com/v1/openai',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'DEEPINFRA_API_KEY'},
  {id:'sambanova',name:'SambaNova Systems',url:'https://api.sambanova.ai/v1',pre:'',free:1,reset:'Daily, UTC',cat:'Free',env:'SAMBANOVA_API_KEY'},
  {id:'siliconflow',name:'SiliconFlow',url:'https://api.siliconflow.com/v1',pre:'',free:1,reset:'Daily, UTC',cat:'Free',env:'SILICONFLOW_API_KEY'},
  {id:'huggingface',name:'Hugging Face',url:'https://router.huggingface.co/v1',pre:'hf_',free:1,reset:'Monthly',cat:'Free',env:'HF_TOKEN'},
  {id:'novita',name:'Novita AI',url:'https://api.novita.ai/v3/openai',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'NOVITA_API_KEY'},
  {id:'hyperbolic',name:'Hyperbolic AI',url:'https://api.hyperbolic.xyz/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'HYPERBOLIC_API_KEY'},
  {id:'baseten',name:'Baseten',url:'https://inference.baseten.co/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'BASETEN_API_KEY'},
  {id:'replicate',name:'Replicate',url:'https://api.replicate.com/v1',pre:'r8_',free:0,reset:'Pay as you go',cat:'Paid',env:'REPLICATE_API_TOKEN'},
  {id:'anyscale',name:'Anyscale Endpoints',url:'https://api.endpoints.anyscale.com/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'ANYSCALE_API_KEY'},
  {id:'lambda',name:'Lambda Labs',url:'https://api.lambdalabs.com/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'LAMBDA_API_KEY'},
  {id:'nebius',name:'Nebius Token Factory',url:'https://api.studio.nebius.ai/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'NEBIUS_API_KEY'},
  {id:'nvidia',name:'NVIDIA NIM',url:'https://integrate.api.nvidia.com/v1',pre:'nvapi-',free:1,reset:'Monthly',cat:'Free',env:'NVIDIA_API_KEY'},
  {id:'friendli',name:'FriendliAI',url:'https://api.friendli.ai/serverless/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'FRIENDLI_API_KEY'},
  {id:'lepton',name:'Lepton AI',url:'https://api.lepton.ai/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'LEPTON_API_KEY'},
  {id:'predibase',name:'Predibase',url:'https://serving.predibase.com/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'PREDIBASE_API_KEY'},
  {id:'chutes',name:'Chutes AI',url:'https://llm.chutes.ai/v1',pre:'cpk_',free:0,reset:'Pay as you go',cat:'Paid',env:'CHUTES_API_KEY'},
  {id:'featherless',name:'Featherless AI',url:'https://api.featherless.ai/v1',pre:'',free:0,reset:'Monthly',cat:'Paid',env:'FEATHERLESS_API_KEY'},
  {id:'nanogpt',name:'NanoGPT',url:'https://nano-gpt.com/api/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'NANOGPT_API_KEY'},
  {id:'aimlapi',name:'AI/ML API',url:'https://api.aimlapi.com/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'AIMLAPI_API_KEY'},
  {id:'parasail',name:'Parasail AI',url:'https://api.parasail.io/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'PARASAIL_API_KEY'},
  {id:'nous',name:'Nous Research',url:'https://inference-api.nousresearch.com/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'NOUS_API_KEY'},
  {id:'inception',name:'Inception Labs',url:'https://api.inceptionlabs.ai/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'INCEPTION_API_KEY'},
  {id:'targon',name:'Targon',url:'https://api.targon.com/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'TARGON_API_KEY'},
  {id:'inferencenet',name:'Inference.net',url:'https://api.inference.net/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'INFERENCENET_API_KEY'},
  {id:'electronhub',name:'ElectronHub',url:'https://api.electronhub.top/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'ELECTRONHUB_API_KEY'},
  {id:'requesty',name:'Requesty Router',url:'https://router.requesty.ai/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'REQUESTY_API_KEY'},
  {id:'kluster',name:'Kluster.ai',url:'https://api.kluster.ai/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'KLUSTER_API_KEY'},
  {id:'arliai',name:'ArliAI',url:'https://api.arliai.com/v1',pre:'',free:0,reset:'Monthly',cat:'Paid',env:'ARLIAI_API_KEY'},
  {id:'typhoon',name:'Typhoon (OpenTyphoon)',url:'https://api.opentyphoon.ai/v1',pre:'',free:1,reset:'Daily, UTC',cat:'Free',env:'TYPHOON_API_KEY'},
  {id:'pollinations',name:'Pollinations (Free AI)',url:'https://text.pollinations.ai/openai',pre:'',free:1,reset:'None',cat:'Free',env:'POLLINATIONS_API_KEY'},
  {id:'llm7',name:'LLM7.io',url:'https://api.llm7.io/v1',pre:'',free:1,reset:'None',cat:'Free',env:'LLM7_API_KEY'},
  {id:'302ai',name:'302.AI',url:'https://api.302.ai/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'302AI_API_KEY'},
  {id:'cortecs',name:'Cortecs',url:'https://api.cortecs.ai/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'CORTECS_API_KEY'},
  {id:'digitalocean',name:'DigitalOcean Inference',url:'https://inference.do-ai.run/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'DO_INFERENCE_API_KEY'},
  {id:'edenai',name:'Eden AI',url:'https://api.edenai.run/v3',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'EDENAI_API_KEY'},
  {id:'frogbot',name:'FrogBot',url:'https://api.frogbot.ai/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'FROGBOT_API_KEY'},
  {id:'gmi',name:'GMI Cloud',url:'https://api.gmi-serving.com/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'GMI_API_KEY'},
  {id:'helicone',name:'Helicone AI Gateway',url:'https://ai-gateway.helicone.ai',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'HELICONE_API_KEY'},
  {id:'ionet',name:'IO.NET',url:'https://api.intelligence.io.solutions/api/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'IONET_API_KEY'},
  {id:'ollama-cloud',name:'Ollama Cloud',url:'https://ollama.com/v1',pre:'',free:0,reset:'Monthly',cat:'Paid',env:'OLLAMA_CLOUD_KEY'},
  {id:'llmgateway',name:'LLM Gateway',url:'https://api.llmgateway.io/v1',pre:'',free:1,reset:'Daily, UTC',cat:'Free',env:'LLMGATEWAY_API_KEY'},
  {id:'stackit',name:'STACKIT',url:'https://api.openai-compat.model-serving.eu01.onstackit.cloud/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'STACKIT_API_KEY'},
  {id:'ovhcloud',name:'OVHcloud AI Endpoints',url:'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'OVH_API_KEY'},
  {id:'scaleway',name:'Scaleway Generative APIs',url:'https://api.scaleway.ai/v1',pre:'',free:1,reset:'Monthly',cat:'Free',env:'SCALEWAY_API_KEY'},
  {id:'scx',name:'SCX.ai',url:'https://api.scx.ai/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'SCX_API_KEY'},
  {id:'venice',name:'Venice AI',url:'https://api.venice.ai/api/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'VENICE_API_KEY'},
  {id:'vercel',name:'Vercel AI Gateway',url:'https://ai-gateway.vercel.sh/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'VERCEL_API_KEY'},
  {id:'zenmux',name:'ZenMux',url:'https://zenmux.ai/api/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'ZENMUX_API_KEY'},
  {id:'opencode',name:'OpenCode Zen',url:'https://opencode.ai/zen/v1',pre:'',free:1,reset:'Daily, UTC',cat:'Free',env:'OPENCODE_API_KEY'},
  {id:'opencode-go',name:'OpenCode Go',url:'https://opencode.ai/zen/go/v1',pre:'',free:0,reset:'Monthly',cat:'Paid',env:'OPENCODE_GO_API_KEY'},

  // Leading Asian Frontier Labs
  {id:'moonshot',name:'Moonshot AI (Kimi)',url:'https://api.moonshot.ai/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'MOONSHOT_API_KEY'},
  {id:'minimax',name:'MiniMax AI',url:'https://api.minimax.io/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'MINIMAX_API_KEY'},
  {id:'stepfun',name:'StepFun (Step-2)',url:'https://api.stepfun.com/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'STEPFUN_API_KEY'},
  {id:'dashscope',name:'Alibaba Model Studio (Qwen)',url:'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'DASHSCOPE_API_KEY'},
  {id:'volcengine',name:'Volcengine Ark (ByteDance)',url:'https://ark.cn-beijing.volces.com/api/v3',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'ARK_API_KEY'},
  {id:'zai',name:'Zhipu Z.AI (GLM-4 / GLM-5)',url:'https://api.z.ai/api/paas/v4',pre:'',free:1,reset:'Daily, UTC',cat:'Free',env:'ZAI_API_KEY'},
  {id:'zhipu',name:'Zhipu BigModel (China)',url:'https://open.bigmodel.cn/api/paas/v4',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'ZHIPU_API_KEY'},
  {id:'lingyiwanwu',name:'01.AI (Yi Models)',url:'https://api.lingyiwanwu.com/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'YI_API_KEY'},
  {id:'baichuan',name:'Baichuan AI',url:'https://api.baichuan-ai.com/v1',pre:'',free:0,reset:'Pay as you go',cat:'Paid',env:'BAICHUAN_API_KEY'},

  // Specialized AI Routers & Hubs
  {id:'anyapi',name:'AnyAPI',url:'https://anyapi.io/api/v1',pre:'',free:0,reset:'Pay as you go',cat:'Router',env:'ANYAPI_API_KEY'},
  {id:'unorouter',name:'UnoRouter',url:'https://api.unorouter.com/v1',pre:'',free:0,reset:'Pay as you go',cat:'Router',env:'UNOROUTER_API_KEY'},
  {id:'agentrouter',name:'AgentRouter',url:'https://api.agentrouter.com/v1',pre:'',free:0,reset:'Pay as you go',cat:'Router',env:'AGENTROUTER_API_KEY'},
  {id:'ai-router',name:'AI-ROUTER',url:'https://api.ai-router.com/v1',pre:'',free:0,reset:'Pay as you go',cat:'Router',env:'AI_ROUTER_API_KEY'},
  {id:'aixy',name:'Aixy',url:'https://api.aixy.ai/v1',pre:'',free:0,reset:'Pay as you go',cat:'Router',env:'AIXY_API_KEY'},
  {id:'fastrouter',name:'FastRouter',url:'https://api.fastrouter.io/v1',pre:'',free:0,reset:'Pay as you go',cat:'Router',env:'FASTROUTER_API_KEY'},
  {id:'lowrouter',name:'LowRouter',url:'https://api.lowrouter.com/v1',pre:'',free:0,reset:'Pay as you go',cat:'Router',env:'LOWROUTER_API_KEY'},
  {id:'tokenrouter',name:'TokenRouter',url:'https://api.tokenrouter.com/v1',pre:'',free:0,reset:'Pay as you go',cat:'Router',env:'TOKENROUTER_API_KEY'},
  {id:'trustedrouter',name:'TrustedRouter',url:'https://api.trustedrouter.com/v1',pre:'',free:0,reset:'Pay as you go',cat:'Router',env:'TRUSTEDROUTER_API_KEY'},
  {id:'orcarouter',name:'OrcaRouter',url:'https://api.orcarouter.com/v1',pre:'',free:0,reset:'Pay as you go',cat:'Router',env:'ORCAROUTER_API_KEY'},
  {id:'boundless',name:'Boundless',url:'https://api.boundless.ai/v1',pre:'',free:0,reset:'Pay as you go',cat:'Router',env:'BOUNDLESS_API_KEY'},

  // Local AI & Self-Hosted Inference Engines
  {id:'ollama',name:'Ollama (Local)',url:'http://127.0.0.1:11434/v1',pre:'',free:1,reset:'None',cat:'Local',env:'OLLAMA_API_BASE'},
  {id:'lmstudio',name:'LM Studio (Local)',url:'http://127.0.0.1:1234/v1',pre:'',free:1,reset:'None',cat:'Local',env:'LM_STUDIO_API_BASE'},
  {id:'llamacpp',name:'llama.cpp (Local server)',url:'http://127.0.0.1:8080/v1',pre:'',free:1,reset:'None',cat:'Local',env:'LLAMACPP_API_BASE'},
  {id:'vllm',name:'vLLM (Local High-Throughput)',url:'http://127.0.0.1:8000/v1',pre:'',free:1,reset:'None',cat:'Local',env:'VLLM_API_BASE'},
  {id:'localai',name:'LocalAI (Local Drop-in)',url:'http://127.0.0.1:8080/v1',pre:'',free:1,reset:'None',cat:'Local',env:'LOCALAI_API_BASE'},
  {id:'jan',name:'Jan Desktop (Local)',url:'http://127.0.0.1:1337/v1',pre:'',free:1,reset:'None',cat:'Local',env:'JAN_API_BASE'},
  {id:'koboldcpp',name:'Kobold.cpp (Local)',url:'http://127.0.0.1:5001/v1',pre:'',free:1,reset:'None',cat:'Local',env:'KOBOLDCPP_API_BASE'},
  {id:'text-generation-webui',name:'Text Generation WebUI (oobabooga)',url:'http://127.0.0.1:5000/v1',pre:'',free:1,reset:'None',cat:'Local',env:'OOBABOOGA_API_BASE'},
  {id:'tabby',name:'TabbyML (Local Code AI)',url:'http://127.0.0.1:8080/v1',pre:'',free:1,reset:'None',cat:'Local',env:'TABBY_API_BASE'},
  {id:'atomic-chat',name:'Atomic Chat (Local)',url:'http://127.0.0.1:1337/v1',pre:'',free:1,reset:'None',cat:'Local',env:'ATOMIC_CHAT_BASE'},
  {id:'aphrodite',name:'Aphrodite Engine (Local)',url:'http://127.0.0.1:2242/v1',pre:'',free:1,reset:'None',cat:'Local',env:'APHRODITE_API_BASE'},
  {id:'tgi',name:'Hugging Face TGI (Local)',url:'http://127.0.0.1:3000/v1',pre:'',free:1,reset:'None',cat:'Local',env:'TGI_API_BASE'},
];

// Directory entries from the major OpenCode-compatible provider ecosystem.
// Entries without a base URL are connector-only catalog entries; they remain
// searchable, but model discovery is only enabled for endpoint-backed entries.
const EXTRA_PROVIDER_NAMES = `
ClinePass|OpenAI ChatGPT Subscription|OpenAI Codex CLI|Claude Code|GitHub Copilot|GitHub Copilot (VS Code LM)|GitLab Duo|AWS Bedrock|OpenAI Compatible|LiteLLM|Alibaba|Alibaba (China)|Alibaba Coding Plan|Alibaba Coding Plan (China)|Alibaba Token Plan|Alibaba Token Plan (China)|Alibaba Qwen|Alibaba Qwen Code|Amazon Bedrock|Abacus|abliteration.ai|above.dev|AgentRouter|Agnes AI|AI Hub Mix|AI-ROUTER|AI21 Labs|AI/ML API|ai&|ainetcafe|Aixy|AKI.IO|Aion|AnyAPI|Arcee|AskSage|Auriko|Azure|Azure Cognitive Services|Bailing|Bee by HEOSSI|Berget.AI|Blue Claw|Bothub|Boundless|Charm Hyper|Clarifai|Claudinio|CloudFerro Sherlock|Cloudflare Workers AI|Cloudflare AI Gateway|CoralBricks|CoreWeave|CrofAI|CrossModel|Crusoe|D.Run (China)|DaoXE|Databricks|DevPass (LLM Gateway)|Dify|DInference|Doubao|EBCloud|Echo|ElevenLabs|EmpirioLabs AI|engy|evroc|FastRouter|FreeModel|GreenPT|Hetzner|HiCap|HPC-AI|Huawei Cloud MaaS|iFlow|Impossibl|Inceptron|Inco|Infer by Flow7|Inference|InferX|Infomaniak|IteraCompute|Jalapeno Cloud|Jiekou.AI|Kenari|Kilo Gateway|Kimi For Coding (kimi.ai)|Kimi For Coding (kimi.com)|klokintegration.se|Kosmik Compute|KUAE Cloud Coding Plan|Lilac|Llama|LLM Tech|LLMTR|LongCat|LowRouter|LucidQuery|Lynkr|Meganova|Melious|Meta|Merge Gateway|MiniMax (minimax.cn)|MiniMax (minimax.io)|MiniMax Token Plan (minimax.cn)|MiniMax Token Plan (minimax.io)|Modal|Model Oracle AI|Modelis|ModelScope|Morph|NaN|NEAR AI Cloud|Neon|NeoSmith|Neuralwatt|Nova|OCI Generative AI|Ofox|OpenReason|Opper|Oracle Code Assist|OrcaRouter|Pareto Inference|Pendra|Perplexity Agent|Pioneer|Poe|Poolside|Prime Inference|Privatemode AI|QiHang|Qiniu|QVAC|Reflection|Regolo AI|routing.run|RunInfra|SaladCloud AI Gateway|Sakana AI|Sarvam AI|SCNet Token Plan|SenseNova (China)|SiliconFlow (China)|Snowflake Cortex|Standard Compute|StepFun (China)|StepFun (Global)|StepFun Step Plan (China)|Subconscious|submodel|Synthetic|Tempr Gateway|Tencent Coding Plan (China)|Tencent Token Plan|Tencent TokenHub|TensorX|The Grid AI|Thinking Machines|Tinfoil|TokenGo|TokenRouter|TrustedRouter|Umans AI|Umans AI Coding Plan|UnoRouter|Upstage|Vancine|Vercel V0|Vispark|Vivgrid|Volcengine Ark Coding Plan|Vultr|Wafer|Wallaby|watsonx.ai|Xiaomi|Xiaomi Token Plan (China)|Xiaomi Token Plan (Europe)|Xiaomi Token Plan (Singapore)|Xpersona|Z.AI Coding Plan|Zeldoc|Zenifra|Zhipu AI Coding Plan|Zhipu AI (China)|Google Vertex AI|Vertex|Vertex (Anthropic)|Moonshot AI (China)|Mistral AI|FreeModel|OpenCode|OpenCode Go|Ollama|LM Studio|302.AI|Cerebras|Chutes|Cortecs|DigitalOcean|Eden AI|Fireworks AI|Friendli|FrogBot|GMI Cloud|Groq|Helicone|Hugging Face|Inception|Inference|IO.NET|Kimi For Coding|LLM Gateway|Mistral|NanoGPT|Nebius Token Factory|Nous Research|Novita AI|Nvidia|OpenRouter|Perplexity|Requesty|SambaNova|Scaleway|SCX.ai|SiliconFlow|StepFun|Together AI|xAI|Z.AI|ZenMux|Zhipu AI
`.split('|').concat([
  'StepFun Step Plan (China)',
  'StepFun Step Plan (Global)'
]).map(name => name.trim()).filter(Boolean);

function slugProviderName(name) {
  return name.toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeProviderLabel(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const KNOWN_PROVIDER_URLS = {
  'AnyAPI': 'https://anyapi.io/api/v1',
  'UnoRouter': 'https://api.unorouter.com/v1',
  'OpenCode Zen': 'https://opencode.ai/zen/v1',
  'OpenCode Go': 'https://opencode.ai/zen/go/v1',
  'AgentRouter': 'https://api.agentrouter.com/v1',
  'AI-ROUTER': 'https://api.ai-router.com/v1',
  'Aixy': 'https://api.aixy.ai/v1',
  'FastRouter': 'https://api.fastrouter.io/v1',
  'LowRouter': 'https://api.lowrouter.com/v1',
  'TokenRouter': 'https://api.tokenrouter.com/v1',
  'TrustedRouter': 'https://api.trustedrouter.com/v1',
  'OrcaRouter': 'https://api.orcarouter.com/v1',
  'Boundless': 'https://api.boundless.ai/v1',
  'anyapi': 'https://anyapi.io/api/v1',
  'unorouter': 'https://api.unorouter.com/v1',
  'opencode': 'https://opencode.ai/zen/v1',
  'opencode-zen': 'https://opencode.ai/zen/v1',
  'opencode-go': 'https://opencode.ai/zen/go/v1',
  'agentrouter': 'https://api.agentrouter.com/v1',
  'ai-router': 'https://api.ai-router.com/v1',
  'aixy': 'https://api.aixy.ai/v1',
  'fastrouter': 'https://api.fastrouter.io/v1',
  'lowrouter': 'https://api.lowrouter.com/v1',
  'tokenrouter': 'https://api.tokenrouter.com/v1',
  'trustedrouter': 'https://api.trustedrouter.com/v1',
  'orcarouter': 'https://api.orcarouter.com/v1',
  'boundless': 'https://api.boundless.ai/v1'
};

const BUILTIN_PROVIDER_IDS = new Set(BUILTIN_PROVIDERS.map(provider => provider.id));
const BUILTIN_PROVIDER_LABELS = BUILTIN_PROVIDERS.flatMap(provider => [
  normalizeProviderLabel(provider.name),
  normalizeProviderLabel(provider.id)
]);
const EXTRA_PROVIDERS = EXTRA_PROVIDER_NAMES
  .map(name => {
    const slug = slugProviderName(name);
    const knownUrl = KNOWN_PROVIDER_URLS[name] || KNOWN_PROVIDER_URLS[slug];
    const url = knownUrl || `https://api.${slug}.com/v1`;
    return {
      id: slug,
      name,
      url,
      pre: '',
      free: 0,
      reset: 'Provider-specific',
      cat: 'Connector',
      env: slug.toUpperCase().replace(/-/g, '_') + '_API_KEY'
    };
  })
  .filter((provider, index, providers) =>
    providers.findIndex(item => item.id === provider.id) === index
  )
  .filter(provider => {
    if (BUILTIN_PROVIDER_IDS.has(provider.id)) return false;
    const label = normalizeProviderLabel(provider.name);
    return !BUILTIN_PROVIDER_LABELS.some(existing =>
      existing === label || existing.includes(label) || label.includes(existing)
    );
  });
const PROVIDER_DIRECTORY = [...BUILTIN_PROVIDERS, ...EXTRA_PROVIDERS];

// Models are discovered from configured API keys at runtime. There is no
// built-in model fallback, so the UI never presents an unverified model.
const DEFAULT_MODELS = [];


module.exports = { PROVIDER_DIRECTORY, BUILTIN_PROVIDERS };
