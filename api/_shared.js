const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';

export function corsHeaders(req) {
  const allowed = process.env.ALLOWED_ORIGIN?.trim();
  const origin = req.headers?.origin || '';
  return {
    'Access-Control-Allow-Origin': !allowed || origin === allowed ? (origin || '*') : allowed,
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
    'Vary': 'Origin'
  };
}

export function sendJson(res, status, data, req) {
  for (const [key, value] of Object.entries(corsHeaders(req))) res.setHeader(key, value);
  return res.status(status).json(data);
}

export function handleOptions(req, res) {
  if (req.method !== 'OPTIONS') return false;
  for (const [key, value] of Object.entries(corsHeaders(req))) res.setHeader(key, value);
  res.status(204).end();
  return true;
}

export function requirePost(req, res) {
  if (req.method === 'POST') return true;
  sendJson(res, 405, { error: '仅支持 POST 请求' }, req);
  return false;
}

export function getGatewayToken() {
  const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!token) throw new Error('AI Gateway 尚未配置：Vercel 部署将自动注入 OIDC，本地调试需 AI_GATEWAY_API_KEY。');
  return token;
}

export async function callDeepSeek({ messages, maxTokens = 8000, temperature = 0.4 }) {
  const response = await fetch(GATEWAY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getGatewayToken()}`
    },
    body: JSON.stringify({
      model: process.env.TEXT_MODEL || 'deepseek/deepseek-v4.1-flash',
      messages,
      max_tokens: maxTokens,
      temperature
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.message || `Gateway HTTP ${response.status}`;
    throw new Error(detail);
  }
  const text = payload?.choices?.[0]?.message?.content;
  if (!text) throw new Error('模型没有返回可用内容。');
  return text;
}

export function parseModelJson(text) {
  const cleaned = String(text)
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

export function stripCodeFence(text) {
  return String(text)
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export function protectGeneratedHtml(html) {
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

export function clipDataUrl(value, maxLength = 5_500_000) {
  if (typeof value !== 'string' || !value.startsWith('data:image/')) throw new Error('缺少有效的产品图片。');
  if (value.length > maxLength) throw new Error('图片过大，请压缩到约 4MB 以内。');
  return value;
}
