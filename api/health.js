import { corsHeaders, getGatewayToken } from './_shared.js';

export default async function handler(req, res) {
  for (const [key, value] of Object.entries(corsHeaders(req))) res.setHeader(key, value);
  const gateway = Boolean(await getGatewayToken().catch(() => ''));
  res.status(200).json({
    ok: true,
    gateway,
    textModel: process.env.TEXT_MODEL || 'deepseek/deepseek-v4.1-flash',
    imageModel: process.env.IMAGE_MODEL || 'bfl/flux-2-flex'
  });
}
