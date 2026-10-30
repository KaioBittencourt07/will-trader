import OpenAI from 'openai';

let client;

function boundedTimeoutMs(value) {
  const parsed = Number(value ?? 15_000);
  if (!Number.isFinite(parsed)) return 15_000;
  return Math.min(30_000, Math.max(5_000, parsed));
}

function getClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY não configurada no backend.');
  client ??= new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    // WILL prefers one bounded observation over hidden retry amplification.
    // A new external attempt must remain explicit and auditable.
    maxRetries: 0,
    timeout: boundedTimeoutMs(process.env.OPENAI_TIMEOUT_MS)
  });
  return client;
}

const SYSTEM_INSTRUCTIONS = `Você é o WILL AI ENGINE. Analise somente os dados fornecidos.
Nunca invente preço, candle, notícia, horário, payout ou resultado.
WAIT é uma decisão válida.
Não transforme baixa evidência em alta confiança.
O resultado determinístico do WILL é a autoridade de risco e direção-base.
Você só pode confirmar ou vetar a direção determinística; nunca substituí-la.
Se houver qualquer dúvida, conflito ou dado insuficiente, use block=true.`;

export async function analyzeWithOpenAI(marketAnalysis) {
  const response = await getClient().responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
    instructions: SYSTEM_INSTRUCTIONS,
    input: JSON.stringify(marketAnalysis),
    text: {
      format: {
        type: 'json_schema',
        name: 'will_analysis',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            direction: { type: 'string', enum: ['BUY', 'SELL', 'WAIT'] },
            score: { type: 'number', minimum: 0, maximum: 100 },
            confidence: { type: 'number', minimum: 0, maximum: 100 },
            thesis: { type: 'string' },
            confirmations: { type: 'array', items: { type: 'string' } },
            risks: { type: 'array', items: { type: 'string' } },
            block: { type: 'boolean' }
          },
          required: ['direction', 'score', 'confidence', 'thesis', 'confirmations', 'risks', 'block'],
          additionalProperties: false
        }
      }
    }
  });
  return JSON.parse(response.output_text);
}
