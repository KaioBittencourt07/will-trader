import { analyzeWithOpenAI } from './openaiEngine.js';

const SYSTEM = `Você é um revisor de risco do WILL TRADER. Analise somente o JSON fornecido. Nunca invente dados. Você só pode confirmar ou vetar a direção determinística; quando houver incerteza, use block=true. Responda JSON com direction (BUY|SELL|WAIT), score (0-100), confidence (0-100), thesis, confirmations (array), risks (array), block (boolean).`;

function parseReview(value, source) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!['BUY', 'SELL', 'WAIT'].includes(parsed?.direction) || !Number.isFinite(Number(parsed?.confidence)) || typeof parsed?.block !== 'boolean') throw new Error(`${source} retornou revisão inválida.`);
  return { ...parsed, source };
}

async function postJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${options.provider} HTTP ${response.status}`);
  return response.json();
}

async function reviewWithGrok(payload) {
  if (!process.env.GROK_API_KEY || !process.env.GROK_MODEL) return null;
  const body = await postJson('https://api.x.ai/v1/chat/completions', {
    provider: 'Grok', method: 'POST', headers: { Authorization: `Bearer ${process.env.GROK_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.GROK_MODEL, temperature: 0, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(payload) }] })
  });
  return parseReview(body.choices?.[0]?.message?.content, 'Grok');
}

async function reviewWithClaude(payload) {
  if (!process.env.CLAUDE_API_KEY || !process.env.CLAUDE_MODEL) return null;
  const body = await postJson('https://api.anthropic.com/v1/messages', {
    provider: 'Claude', method: 'POST', headers: { 'x-api-key': process.env.CLAUDE_API_KEY, 'anthropic-version': process.env.CLAUDE_API_VERSION || '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.CLAUDE_MODEL, max_tokens: 500, temperature: 0, system: SYSTEM, messages: [{ role: 'user', content: JSON.stringify(payload) }] })
  });
  return parseReview(body.content?.find((item) => item.type === 'text')?.text, 'Claude');
}

export async function collectAdvisorReviews(payload) {
  const jobs = [];
  if (process.env.OPENAI_API_KEY) jobs.push(analyzeWithOpenAI(payload).then((review) => parseReview(review, 'OpenAI')));
  if (process.env.GROK_API_KEY && process.env.GROK_MODEL) jobs.push(reviewWithGrok(payload));
  if (process.env.CLAUDE_API_KEY && process.env.CLAUDE_MODEL) jobs.push(reviewWithClaude(payload));
  const settled = await Promise.allSettled(jobs);
  return { reviews: settled.filter((item) => item.status === 'fulfilled' && item.value).map((item) => item.value), failures: settled.filter((item) => item.status === 'rejected').map((item) => item.reason.message) };
}
