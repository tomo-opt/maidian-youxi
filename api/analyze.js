import { callDeepSeek, clipDataUrl, handleOptions, parseModelJson, requirePost, sendJson } from './_shared.js';

export default async function handler(req, res) {
  if (handleOptions(req, res) || !requirePost(req, res)) return;
  try {
    const { image, category = '自动识别', audience = '', channel = '', goal = '' } = req.body || {};
    const imageData = clipDataUrl(image);
    const prompt = `你是家电产品洞察、互动创意与前端体验策划专家。请真实分析用户上传的产品图，不要假定具体品牌或无法从图片证明的技术参数。

已知信息：
- 用户选择品类：${category}
- 目标人群：${audience || '未填写'}
- 首发渠道：${channel || '网页互动'}
- 用户希望强调：${goal || '未填写'}

请输出且只输出 JSON，格式必须完全符合：
{
  "product": {"category":"", "visualSummary":"", "visibleFeatures":[""], "uncertainties":[""]},
  "claims": [
    {"id":"claim-1","title":"","consumerBenefit":"","evidence":"visible|user_input|needs_evidence","confidence":0.0,"reason":""}
  ],
  "concepts": [
    {"id":"concept-1","name":"","hook":"","interaction":"","visualStyle":"","characterIdea":"","wowMoment":"","imagePrompt":"","risk":"low|medium|high"}
  ]
}

要求：
1. claims 生成 3–5 条，其中图片无法证明的功能标为 needs_evidence；用户主动填写的卖点可标为 user_input。
2. concepts 生成恰好 3 套，必须明显不同，不套固定模板；每套都说明用户实际能做什么。
3. 至少一套包含原创角色或产品拟人化，但不得模仿已知版权角色。
4. imagePrompt 用中文写清楚后续图像模型要生成的原创角色/场景素材，保留产品外观特征，不写任何品牌文字。
5. 所有内容针对本次图片，不要泛泛而谈。`;

    const text = await callDeepSeek({
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: imageData, detail: 'original' } }
      ] }],
      maxTokens: 7000,
      temperature: 0.55
    });
    const result = parseModelJson(text);
    if (!Array.isArray(result.claims) || !Array.isArray(result.concepts)) throw new Error('分析结果缺少卖点或创意方案。');
    return sendJson(res, 200, result, req);
  } catch (error) {
    return sendJson(res, 500, { error: error.message || '分析失败' }, req);
  }
}
