const MODELS = {
  vision: '@cf/moondream/moondream3.1-9B-A2B',
  strategy: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  code: '@cf/qwen/qwen3-30b-a3b-fp8',
  image: '@cf/black-forest-labs/flux-1-schnell'
};

const ALLOWED_ORIGINS = new Set([
  'https://tomo-opt.github.io',
  'https://maidian-youxi.vercel.app',
  'http://127.0.0.1:4173',
  'http://localhost:4173'
]);

function headers(request) {
  const origin = request.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://tomo-opt.github.io',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
    'Vary': 'Origin'
  };
}

function json(request, data, status = 200) {
  return Response.json(data, { status, headers: headers(request) });
}

function allowed(request) {
  const origin = request.headers.get('Origin');
  return !origin || ALLOWED_ORIGINS.has(origin);
}

function parseModelJson(text) {
  if (text && typeof text === 'object') return text;
  const cleaned = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('模型返回的结构无法解析，请重新生成。');
  }
}

function stripCodeFence(text) {
  return String(text || '').replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function modelText(result) {
  const value = result?.response || result?.choices?.[0]?.message?.content || '';
  return value && typeof value === 'object' ? JSON.stringify(value) : value;
}

function protectGeneratedHtml(html) {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`;
  const reporter = `<script>window.addEventListener('error',function(e){parent.postMessage({source:'hookplay-preview',type:'runtime-error',message:String(e.message||'未知错误'),line:e.lineno||0},'*')});parent.postMessage({source:'hookplay-preview',type:'ready'},'*');<\/script>`;
  let safe = stripCodeFence(html)
    .replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']*["'][^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<(?:iframe|object|embed|form)\b[\s\S]*?<\/(?:iframe|object|embed|form)>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '');
  if (/<head[\s>]/i.test(safe)) safe = safe.replace(/<head([^>]*)>/i, `<head$1>${csp}`);
  else safe = safe.replace(/<html([^>]*)>/i, `<html$1><head>${csp}</head>`);
  if (/<body[\s>]/i.test(safe)) safe = safe.replace(/<body([^>]*)>/i, `<body$1>${reporter}`);
  else safe += reporter;
  return safe;
}

function imageData(value, maxLength = 8_000_000) {
  if (typeof value !== 'string' || !value.startsWith('data:image/')) throw new Error('缺少有效的产品图片。');
  if (value.length > maxLength) throw new Error('图片过大，请压缩后重试。');
  return value;
}

async function body(request) {
  try {
    return await request.json();
  } catch {
    throw new Error('请求内容无法读取。');
  }
}

async function analyze(input, env) {
  const image = imageData(input.image);
  const vision = await env.AI.run(MODELS.vision, {
    task: 'query',
    image,
    question: 'Describe the product in this image in concrete visual detail: category, shape, colors, doors, panels, handles, visible compartments, surrounding scene, and possible interaction cues. State only what is visibly present. Do not guess brand, model, specifications, or hidden technology.',
    reasoning: false,
    stream: false,
    max_tokens: 1200,
    temperature: 0.2
  });
  const visionText = String(vision.answer || vision.caption || vision.result?.answer || vision.result?.caption || '').trim();
  const prompt = `你是家电产品洞察、互动创意与前端体验策划专家。根据视觉模型的观察与用户输入形成营销创意，不假定品牌或图片无法证明的参数。

视觉模型观察：
${visionText || '未返回有效观察'}

已知信息：
- 用户选择品类：${input.category || '自动识别'}
- 目标人群：${input.audience || '未填写'}
- 首发渠道：${input.channel || '网页互动'}
- 用户希望强调：${input.goal || '未填写'}

只输出 JSON：
{"product":{"category":"","visualSummary":"","visibleFeatures":[""],"uncertainties":[""]},"claims":[{"id":"claim-1","title":"","consumerBenefit":"","evidence":"visible|user_input|needs_evidence","confidence":0.0,"reason":""}],"concepts":[{"id":"concept-1","name":"","hook":"","interaction":"","visualStyle":"","characterIdea":"","wowMoment":"","imagePrompt":"","risk":"low|medium|high"}]}

要求：claims 3–5 条；无法由图证明的功能标 needs_evidence；concepts 恰好 3 套且明显不同；至少一套含原创角色或产品拟人化；每套明确用户实际动作；imagePrompt 用中文写原创16:9场景素材且不含品牌文字；全部针对本图。`;
  const result = await env.AI.run(MODELS.strategy, {
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 5000,
    temperature: 0.35,
    response_format: { type: 'json_object' }
  });
  const parsed = parseModelJson(modelText(result));
  if (!Array.isArray(parsed.claims) || !Array.isArray(parsed.concepts)) throw new Error('分析结果缺少卖点或创意方案。');
  const observation = visionText;
  parsed.product ||= {};
  parsed.product.category ||= input.category || '家电';
  parsed.product.visualSummary ||= observation || '视觉模型已完成识别，建议结合产品资料确认技术细节。';
  parsed.product.visibleFeatures = (Array.isArray(parsed.product.visibleFeatures) ? parsed.product.visibleFeatures : []).filter(Boolean);
  parsed.product.uncertainties = (Array.isArray(parsed.product.uncertainties) ? parsed.product.uncertainties : []).filter(Boolean);
  parsed.claims = parsed.claims.slice(0, 5).map((claim, index) => ({
    id: claim.id || `claim-${index + 1}`,
    title: claim.title || `卖点方向 ${index + 1}`,
    consumerBenefit: claim.consumerBenefit || claim.reason || '待进一步确认消费者收益。',
    evidence: ['visible', 'user_input', 'needs_evidence'].includes(claim.evidence) ? claim.evidence : 'needs_evidence',
    confidence: Number.isFinite(Number(claim.confidence)) ? Number(claim.confidence) : 0.5,
    reason: claim.reason || '由本次图片与用户输入综合推导。'
  }));
  parsed.concepts = parsed.concepts.slice(0, 3).map((concept, index) => ({
    id: concept.id || `concept-${index + 1}`,
    name: concept.name || `互动创意 ${index + 1}`,
    hook: concept.hook || '把产品特征转化成可操作的视觉反馈。',
    interaction: concept.interaction || '通过点击、拖拽和状态变化完成挑战。',
    visualStyle: concept.visualStyle || '原创、轻未来感、产品主体清晰的互动场景',
    characterIdea: concept.characterIdea || '根据本次产品气质生成原创陪伴角色或产品拟人形态',
    wowMoment: concept.wowMoment || `${concept.hook || concept.name || '完成挑战'}时触发全屏视觉反馈`,
    imagePrompt: concept.imagePrompt || `${observation}\n围绕“${concept.name || concept.hook || '互动创意'}”生成原创家电互动营销场景，产品主体完整，留出操作空间。`,
    risk: ['low', 'medium', 'high'].includes(concept.risk) ? concept.risk : 'medium'
  }));
  return parsed;
}

async function generateImage(input, env) {
  const prompt = String(input.prompt || '').trim();
  if (prompt.length < 20 || prompt.length > 1800) throw new Error('图像提示词长度不合适。');
  const result = await env.AI.run(MODELS.image, {
    prompt: `${prompt}\n原创家电互动营销场景，构图适合网页主视觉，主体清晰，留出互动空间，不含品牌Logo、版权角色、可读文字或水印。`,
    steps: 4
  });
  if (!result?.image) throw new Error('图像模型没有返回图片。');
  return { image: `data:image/jpeg;base64,${result.image}` };
}

async function generateExperience(input, env) {
  const product = imageData(input.productImage);
  const scene = input.sceneImage ? imageData(input.sceneImage, 10_000_000) : '';
  if (!input.concept?.name) throw new Error('请先选择一套互动方案。');
  const brief = JSON.stringify({
    product: input.analysis?.product || {},
    selectedClaims: Array.isArray(input.selectedClaims) ? input.selectedClaims : [],
    concept: input.concept,
    authorIdea: input.authorIdea || ''
  }, null, 2);
  const prompt = `你是世界级创意前端工程师。根据项目简报，从零编写一个真正可玩的单文件 HTML 互动营销体验。它不是落地页或方案介绍页，打开后立即进入可玩场景。

项目简报：
${brief}

硬性要求：
1. 只返回完整 HTML，不要代码围栏或解释。
2. CSS 与 JavaScript 全部内联；不得引用外部脚本、字体、接口或URL；不得使用 fetch、XHR、WebSocket、表单、iframe、object、embed、location、top、opener。
3. 产品原图必须使用精确占位符 {{PRODUCT_IMAGE}}；AI 场景图使用 {{SCENE_IMAGE}}，不得改写。
4. 必须有清晰互动目标、至少三种用户动作或状态变化、即时反馈、完成状态、重新开始。
5. 支持鼠标、触摸、键盘；在 360×720 与 1440×900 均可玩且无横向溢出。
6. 中文文案简短自然，通过行为表达卖点，不虚构参数。
7. 产品图保持完整不拉伸；场景图仅作背景或角色素材。
8. 加入适量粒子、光效、状态动画或物理反馈，保持流畅。
9. 使用原生 HTML/CSS/JS，可用 Canvas 与 Web Audio API，但不得联网。
10. 包含 ARIA 标签并尊重 prefers-reduced-motion。
11. 代码保持紧凑，完整 HTML 控制在约 15–25KB，避免重复样式与冗长文案。`;
  const result = await env.AI.run(MODELS.code, {
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 10000,
    temperature: 0.62,
    repetition_penalty: 1.05
  });
  let html = protectGeneratedHtml(modelText(result))
    .replaceAll('{{PRODUCT_IMAGE}}', product)
    .replaceAll('{{SCENE_IMAGE}}', scene || product);
  if (!/<html[\s>]/i.test(html) || !/<script[\s>]/i.test(html)) throw new Error('生成结果不是完整的可互动 HTML，请重试。');
  return { html };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!allowed(request)) return json(request, { error: '该来源未获准访问。' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(request) });
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json(request, { ok: true, gateway: true, provider: 'cloudflare-workers-ai', models: MODELS });
    }
    if (request.method !== 'POST') return json(request, { error: '未找到服务。' }, 404);
    try {
      const input = await body(request);
      if (url.pathname === '/api/analyze') return json(request, await analyze(input, env));
      if (url.pathname === '/api/generate-image') return json(request, await generateImage(input, env));
      if (url.pathname === '/api/generate-experience') return json(request, await generateExperience(input, env));
      return json(request, { error: '未找到服务。' }, 404);
    } catch (error) {
      return json(request, { error: error?.message || '生成失败' }, 500);
    }
  }
};
