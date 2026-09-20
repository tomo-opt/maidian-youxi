import { generateImage } from 'ai';
import { handleOptions, requirePost, sendJson } from './_shared.js';

export default async function handler(req, res) {
  if (handleOptions(req, res) || !requirePost(req, res)) return;
  try {
    const prompt = String(req.body?.prompt || '').trim();
    if (prompt.length < 20 || prompt.length > 4000) throw new Error('图像提示词长度不合适。');
    const result = await generateImage({
      model: process.env.IMAGE_MODEL || 'bfl/flux-2-flex',
      prompt: `${prompt}\n作品用途：家电产品互动营销网页。必须原创，不使用任何品牌Logo、版权角色、可读文字或水印。构图适合16:9网页主场景，主体清晰，留出互动空间。`,
      aspectRatio: '16:9'
    });
    const image = result.images?.[0];
    if (!image?.base64) throw new Error('图像模型没有返回图片。');
    return sendJson(res, 200, { image: `data:${image.mediaType || 'image/png'};base64,${image.base64}` }, req);
  } catch (error) {
    return sendJson(res, 500, { error: error.message || '图像生成失败' }, req);
  }
}
