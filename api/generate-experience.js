import { callDeepSeek, clipDataUrl, handleOptions, protectGeneratedHtml, requirePost, sendJson } from './_shared.js';

export default async function handler(req, res) {
  if (handleOptions(req, res) || !requirePost(req, res)) return;
  try {
    const { productImage, sceneImage, analysis, selectedClaims, concept, authorIdea = '' } = req.body || {};
    const product = clipDataUrl(productImage);
    const scene = sceneImage ? clipDataUrl(sceneImage, 9_000_000) : '';
    if (!concept?.name) throw new Error('请先选择一套互动方案。');

    const brief = JSON.stringify({
      product: analysis?.product || {},
      selectedClaims: Array.isArray(selectedClaims) ? selectedClaims : [],
      concept,
      authorIdea
    }, null, 2);

    const prompt = `你是世界级创意前端工程师。根据图片和项目简报，从零编写一个真正可玩的、单文件 HTML 互动营销体验。它不是落地页，也不是方案介绍页，打开后应立即进入可玩场景。

项目简报：
${brief}

硬性要求：
1. 只返回完整 HTML，不要 Markdown 代码围栏或解释。
2. 所有 CSS 与 JavaScript 内联；不得引用任何外部脚本、字体、接口或URL；不得使用 fetch、XHR、WebSocket、表单、iframe、object、embed、location、top、opener。
3. 在需要产品原图处使用精确占位符 {{PRODUCT_IMAGE}}；如存在 AI 场景图，在需要处使用 {{SCENE_IMAGE}}。不要改写占位符。
4. 必须有清晰的互动目标、至少三种用户动作或状态变化、即时反馈、完成状态和重新开始功能。
5. 支持鼠标、触摸和键盘；在 360×720 与 1440×900 下均可玩，不出现横向溢出。
6. 中文文案简短自然，把卖点通过行为表达，避免大段解释和虚构参数。
7. 产品图保持主体完整，不拉伸；AI场景图只作为辅助背景或角色素材。
8. 视觉应达到比赛演示水准，包含有节制的粒子、光效、状态动画或物理反馈，但保持流畅。
9. 使用原生 HTML/CSS/JS，可使用 Canvas 与 Web Audio API；不得依赖网络。
10. 在代码中写清楚 ARIA 标签，并尊重 prefers-reduced-motion。

请直接输出作品。`;

    const content = [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: product, detail: 'original' } }];
    if (scene) content.push({ type: 'image_url', image_url: { url: scene, detail: 'low' } });
    const raw = await callDeepSeek({ messages: [{ role: 'user', content }], maxTokens: 20000, temperature: 0.65 });
    let html = protectGeneratedHtml(raw)
      .replaceAll('{{PRODUCT_IMAGE}}', product)
      .replaceAll('{{SCENE_IMAGE}}', scene || product);
    if (!/<html[\s>]/i.test(html) || !/<script[\s>]/i.test(html)) throw new Error('生成结果不是完整的可互动 HTML，请重试。');
    return sendJson(res, 200, { html }, req);
  } catch (error) {
    return sendJson(res, 500, { error: error.message || '互动生成失败' }, req);
  }
}
