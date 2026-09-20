import { corsHeaders } from './_shared.js';

export default async function handler(req, res) {
  for (const [key, value] of Object.entries(corsHeaders(req))) res.setHeader(key, value);
  res.status(200).json({
    ok: true,
    gateway: Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN),
    textModel: process.env.TEXT_MODEL || 'deepseek/deepseek-v4.1-flash',
    imageModel: process.env.IMAGE_MODEL || 'bfl/flux-2-flex'
  });
}
