const MODELS = {
  vision: '@cf/moondream/moondream3.1-9B-A2B',
  strategy: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  code: '@cf/qwen/qwen3-30b-a3b-fp8',
  image: '@cf/black-forest-labs/flux-2-klein-4b',
  imageFallback: '@cf/runwayml/stable-diffusion-v1-5-img2img'
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

function dataUrlToBlob(value) {
  const match = imageData(value, 10_000_000).match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) throw new Error('参考图格式无效。');
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: match[1] });
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function generatedImageBase64(result) {
  if (typeof result?.image === 'string') return result.image;
  const stream = result instanceof ReadableStream ? result : result?.response instanceof ReadableStream ? result.response : null;
  if (stream) return bytesToBase64(new Uint8Array(await new Response(stream).arrayBuffer()));
  throw new Error('图像模型没有返回图片。');
}

async function referenceImage(env, { prompt, references, width, height }) {
  const refs = references.filter(Boolean).slice(0, 4);
  try {
    const form = new FormData();
    form.append('prompt', prompt);
    form.append('width', String(width));
    form.append('height', String(height));
    form.append('guidance', '4');
    refs.forEach((value, index) => form.append(`input_image_${index}`, dataUrlToBlob(value), `reference-${index}.jpg`));
    const encoded = new Response(form);
    const result = await env.AI.run(MODELS.image, {
      multipart: { body: encoded.body, contentType: encoded.headers.get('content-type') }
    });
    return { image: `data:image/jpeg;base64,${await generatedImageBase64(result)}`, model: MODELS.image };
  } catch (primaryError) {
    const fallbackReference = refs[0];
    if (!fallbackReference) throw primaryError;
    const result = await env.AI.run(MODELS.imageFallback, {
      prompt,
      negative_prompt: 'text, logo, watermark, collage, product photo pasted on background, different character, inconsistent design, duplicate body parts',
      image_b64: fallbackReference.split(',')[1],
      width,
      height,
      num_steps: 12,
      strength: 0.72,
      guidance: 8
    });
    return { image: `data:image/png;base64,${await generatedImageBase64(result)}`, model: MODELS.imageFallback };
  }
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
{"product":{"category":"","visualSummary":"","visibleFeatures":[""],"uncertainties":[""]},"claims":[{"id":"claim-1","title":"","consumerBenefit":"","evidence":"visible|user_input|needs_evidence","confidence":0.0,"reason":""}],"concepts":[{"id":"concept-1","name":"","hook":"","visualStyle":"","characterDesign":{"archetype":"","designStatement":"","preservedFeatures":[""],"partMappings":[{"source":"","target":""}],"palette":[""],"signatureAbility":"","doNotChange":[""]},"interactionPlan":{"goal":"","actions":[""],"states":[""],"completion":"","payoff":""},"imagePrompts":{"character":"","action":""},"risk":"low|medium|high"}]}

要求：
1. claims 3–5 条；无法由图证明的功能标 needs_evidence；concepts 恰好 3 套且明显不同。
2. 三套都必须是“产品原生角色化”：从当前产品的真实轮廓、门体、把手、面板、配色或材质中提取造型语言，不能只是给产品旁边加一个无关角色。
3. characterDesign 必须给出4–6条 partMappings，逐项说明产品部件如何变成角色身体、装备或表情系统，并列出4–6个必须保留的产品识别锚点。
4. signatureAbility 必须把用户确认的核心卖点转成角色能力；interactionPlan.actions 恰好4步、states 至少5态，每个动作和状态都围绕该能力展开，不能只是点击看文案。
5. imagePrompts.character 用于参考图角色定妆，要求单一完整原创角色、清晰轮廓、无文字、无品牌；imagePrompts.action 用于以同一角色生成16:9动作主视觉，必须保持角色身份一致并表现互动高潮。
6. 全部针对本图，不使用已有版权角色，不输出营销参数臆测。`;
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
  parsed.concepts = parsed.concepts.slice(0, 3).map((concept, index) => {
    const design = concept.characterDesign || {};
    const plan = concept.interactionPlan || {};
    const prompts = concept.imagePrompts || {};
    const features = (Array.isArray(design.preservedFeatures) ? design.preservedFeatures : parsed.product.visibleFeatures).filter(Boolean).slice(0, 6);
    const mappings = (Array.isArray(design.partMappings) ? design.partMappings : []).filter(item => item?.source && item?.target).slice(0, 6);
    const mappingFallbacks = features.map((feature, featureIndex) => ({ source: feature, target: ['角色躯干轮廓', '肩部或翼状装甲', '胸前能量核心', '手臂工具或武器', '腿部动力结构', '表情与灯光系统'][featureIndex] }));
    const finalMappings = [...mappings, ...mappingFallbacks].filter((item, itemIndex, all) => all.findIndex(other => other.source === item.source) === itemIndex).slice(0, 6);
    const ability = design.signatureAbility || concept.hook || '将核心卖点转化为可操作的角色技能';
    const rawActions = (Array.isArray(plan.actions) ? plan.actions : []).filter(Boolean);
    const actions = [...rawActions, '拖拽场景组件为角色蓄能', '长按角色核心稳定能力', `点击释放“${ability}”`, '观察环境变化并完成挑战'].filter((item, itemIndex, all) => all.indexOf(item) === itemIndex).slice(0, 4);
    const rawStates = (Array.isArray(plan.states) ? plan.states : []).filter(Boolean);
    const states = [...rawStates, '待机引导', '组件收集', '能力蓄能', '技能释放', '完成与重新开始'].filter((item, itemIndex, all) => all.indexOf(item) === itemIndex).slice(0, 6);
    const name = concept.name || `产品角色方案 ${index + 1}`;
    const rawCharacterPrompt = String(prompts.character || '').trim();
    const characterPrompt = rawCharacterPrompt.length >= 20 ? rawCharacterPrompt : `以输入产品为唯一造型母体，设计“${name}”原创角色。保留这些识别特征：${features.join('、')}。产品部件必须转化为角色身体或装备，不要把原产品照片贴在角色旁边。`;
    const rawActionPrompt = String(prompts.action || '').trim();
    return {
      id: concept.id || `concept-${index + 1}`,
      name,
      hook: concept.hook || ability,
      visualStyle: concept.visualStyle || '产品原生、造型统一、轮廓鲜明的原创角色设计',
      characterDesign: {
        archetype: design.archetype || '产品拟人化原创角色',
        designStatement: design.designStatement || '从本次产品结构直接演化角色造型，而非产品与角色并置。',
        preservedFeatures: features,
        partMappings: finalMappings.length ? finalMappings : [{ source: '产品主体轮廓与面板', target: '角色躯干与核心装甲' }],
        palette: (Array.isArray(design.palette) ? design.palette : []).filter(Boolean).slice(0, 5),
        signatureAbility: ability,
        doNotChange: (Array.isArray(design.doNotChange) ? design.doNotChange : features).filter(Boolean).slice(0, 6)
      },
      interactionPlan: {
        goal: plan.goal || `操作角色发动“${ability}”并完成卖点挑战`,
        actions,
        states,
        completion: plan.completion || '完成核心任务后进入明确胜利状态，并可重新开始。',
        payoff: plan.payoff || `用角色能力“${ability}”直观证明所选卖点。`
      },
      imagePrompts: {
        character: characterPrompt,
        action: rawActionPrompt.length >= 20 ? rawActionPrompt : `让输入角色保持完全相同的脸、轮廓、配色和装备，在动态场景中发动“${ability}”。角色的能力必须通过动作、环境变化和视觉反馈被看见，无文字与Logo。`
      },
      risk: ['low', 'medium', 'high'].includes(concept.risk) ? concept.risk : 'medium'
    };
  });
  return parsed;
}

async function generateCharacter(input, env) {
  const product = imageData(input.productImage, 4_000_000);
  const concept = input.concept || {};
  const design = concept.characterDesign || {};
  const anchors = (design.preservedFeatures || []).join('、');
  const mappings = (design.partMappings || []).map(item => `${item.source}→${item.target}`).join('；');
  const authorIdea = String(input.authorIdea || concept.authorIdea || '').trim().slice(0, 800);
  const rawPrompt = String(concept.imagePrompts?.character || '').trim();
  const prompt = rawPrompt.length >= 20 ? rawPrompt : `以输入产品为唯一造型母体，设计“${concept.name || '原创产品角色'}”。保留${anchors || '产品主体轮廓、面板和材质'}，将产品部件变成角色身体与装备。`;
  if (prompt.length > 2400) throw new Error('角色定妆提示词过长。');
  return referenceImage(env, {
    references: [product],
    width: 768,
    height: 768,
    prompt: `Image 0 is the ONLY product reference. Transform its actual silhouette and components into one original character; do not place the unchanged product beside a generic person. ${prompt}\nIdentity anchors that must remain visibly recognizable: ${anchors}. Component mapping: ${mappings}. Signature ability: ${design.signatureAbility || concept.hook || ''}. ${authorIdea ? `Author direction: ${authorIdea}.` : ''} ${input.critique ? `Fix from review: ${input.critique}.` : ''} Full-body hero character, coherent anatomy, clean cinematic background, no split screen, no contact sheet, no readable text, no logo, no watermark, no copyrighted character.`
  });
}

async function validateCharacter(input, env) {
  const comparison = imageData(input.comparisonImage, 6_000_000);
  const anchors = Array.isArray(input.anchors) ? input.anchors.filter(Boolean).slice(0, 8).join(', ') : '';
  const result = await env.AI.run(MODELS.vision, {
    task: 'query',
    image: comparison,
    question: `This is a two-panel board: LEFT is the source appliance, RIGHT is a generated character derived from it. Evaluate whether the RIGHT character visibly inherits the LEFT product rather than merely standing beside or copying it. Expected anchors: ${anchors}. Return JSON only: {"score":0,"preserved":[""],"missing":[""],"critique":""}. Score 0-10; 7+ means recognizably derived, coherent and usable.`,
    reasoning: false,
    stream: false,
    max_tokens: 500,
    temperature: 0.1
  });
  try {
    const parsed = parseModelJson(String(result.answer || result.caption || modelText(result)));
    const score = Math.max(0, Math.min(10, Number(parsed.score) || 0));
    return {
      pass: score >= 7,
      score,
      preserved: Array.isArray(parsed.preserved) ? parsed.preserved.slice(0, 6) : [],
      missing: Array.isArray(parsed.missing) ? parsed.missing.slice(0, 6) : [],
      critique: String(parsed.critique || '').slice(0, 500)
    };
  } catch {
    return { pass: true, score: 7, preserved: [], missing: [], critique: '自动复核未返回结构化结果，已保留人工预览。' };
  }
}

async function generateAction(input, env) {
  const character = imageData(input.characterImage, 10_000_000);
  const product = imageData(input.productImage, 4_000_000);
  const concept = input.concept || {};
  const rawPrompt = String(concept.imagePrompts?.action || '').trim();
  const prompt = rawPrompt.length >= 20 ? rawPrompt : `让已确认角色保持完全相同的造型，在动态场景中发动“${concept.characterDesign?.signatureAbility || concept.hook || '产品核心能力'}”，以动作和环境反馈表现卖点。`;
  const authorIdea = String(input.authorIdea || concept.authorIdea || '').trim().slice(0, 800);
  if (prompt.length > 2400) throw new Error('动作主视觉提示词过长。');
  return referenceImage(env, {
    references: [character, product],
    width: 1024,
    height: 768,
    prompt: `Image 0 is the approved character master. Image 1 is the original product reference. Create a single cinematic 4:3 action key visual using EXACTLY the same character identity, face, silhouette, palette and product-derived components from image 0. ${prompt}\n${authorIdea ? `Author direction: ${authorIdea}.` : ''} Show the character actively using its signature product ability; reserve clear foreground space for browser interaction effects. Do not paste the original product photo into the scene. No collage, no duplicate character, no readable text, no logo, no watermark.`
  });
}

async function generateExperience(input, env) {
  const character = imageData(input.characterImage, 10_000_000);
  const action = imageData(input.actionImage, 12_000_000);
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
3. 角色定妆图必须使用精确占位符 {{CHARACTER_IMAGE}}；同角色动作主视觉必须使用 {{ACTION_IMAGE}}，不得改写。不得展示或模拟原始产品照片。
4. 打开即进入以角色为主角的可玩场景；不能做成海报、卡片陈列、功能标签墙或方案介绍页。
5. 必须严格采用简报里的 interactionPlan：有清晰任务、至少三种真实用户动作或连续状态、即时反馈、完成状态和重新开始。
6. 每个关键动作都必须表现 signatureAbility 对应的产品卖点；角色动作、视觉反馈和卖点是同一件事，不能点击后只弹文字。
7. {{CHARACTER_IMAGE}} 是可操作主角，可通过容器位移、缩放、旋转、遮罩、滤镜和粒子形成动画；{{ACTION_IMAGE}} 只在技能高潮或完成时沉浸式揭示。
8. 必须在画面中持续显示一句明确操作指引和可读进度；至少实现两种不同操作类型（拖拽、按住、点击、滑动或键盘中的两种），不能把全部玩法退化成点一下图片。
9. 完成时显示明确成功状态与可见的“重新开始”按钮；重新开始必须完整恢复初始状态。
10. 支持鼠标、触摸、键盘；在 360×720 与 1440×900 均可玩且无横向溢出。
11. 中文文案简短自然，通过行为表达卖点，不虚构参数。
12. 加入粒子、光效、状态动画或物理反馈，保持流畅；不得用静态说明替代互动。
13. 使用原生 HTML/CSS/JS，可用 Canvas 与 Web Audio API，但不得联网。
14. 包含 ARIA 标签并尊重 prefers-reduced-motion。
15. 代码保持紧凑，完整 HTML 控制在约 18–30KB，避免重复样式与冗长文案。`;
  const result = await env.AI.run(MODELS.code, {
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 10000,
    temperature: 0.42,
    repetition_penalty: 1.05
  });
  let html = protectGeneratedHtml(modelText(result))
    .replaceAll('{{CHARACTER_IMAGE}}', character)
    .replaceAll('{{ACTION_IMAGE}}', action);
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
      if (url.pathname === '/api/generate-character') return json(request, await generateCharacter(input, env));
      if (url.pathname === '/api/validate-character') return json(request, await validateCharacter(input, env));
      if (url.pathname === '/api/generate-action') return json(request, await generateAction(input, env));
      if (url.pathname === '/api/generate-experience') return json(request, await generateExperience(input, env));
      return json(request, { error: '未找到服务。' }, 404);
    } catch (error) {
      return json(request, { error: error?.message || '生成失败' }, 500);
    }
  }
};
