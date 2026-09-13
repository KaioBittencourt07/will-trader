import fs from 'node:fs';
import path from 'node:path';

const STATUSES = new Set(['PROPOSED', 'OBSERVING', 'VALIDATED', 'REJECTED']);
const SOURCE_TYPES = new Set(['YOUTUBE', 'USER', 'DOCUMENTATION', 'MODEL_REVIEW']);

function cleanText(value, field, { required = false, max = 1_000 } = {}) {
  if (value == null && !required) return null;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} inválido.`);
  return value.trim().slice(0, max);
}

function normalizeSource(source = {}) {
  const type = String(source.type ?? 'USER').toUpperCase();
  if (!SOURCE_TYPES.has(type)) throw new Error('Tipo de fonte inválido.');
  const url = cleanText(source.url, 'URL da fonte', { max: 2_000 });
  if (url && !/^https?:\/\//i.test(url)) throw new Error('URL da fonte inválida.');
  return {
    type,
    title: cleanText(source.title, 'Título da fonte', { required: true, max: 240 }),
    url,
    author: cleanText(source.author, 'Autor da fonte', { max: 120 })
  };
}

function normalizeTags(tags) {
  if (tags == null) return [];
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string')) throw new Error('Tags inválidas.');
  return [...new Set(tags.map((tag) => tag.trim().toUpperCase()).filter(Boolean))].slice(0, 12);
}

/**
 * A research item is deliberately separate from the live decision engine.
 * It can become VALIDATED only after an explicit out-of-sample evidence review.
 */
export function createResearchMemory({ filePath = null, now = () => new Date().toISOString(), id = () => crypto.randomUUID(), minimumSamples = 30 } = {}) {
  let items = [];
  if (filePath && fs.existsSync(filePath)) {
    const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(saved)) throw new Error('Memória de pesquisa persistida inválida.');
    items = saved;
  }

  function persist() {
    if (!filePath) return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(items, null, 2));
    fs.renameSync(temporary, filePath);
  }

  function add({ source, hypothesis, summary = null, tags = [] } = {}) {
    const item = {
      id: id(),
      createdAt: now(),
      source: normalizeSource(source),
      hypothesis: cleanText(hypothesis, 'Hipótese', { required: true, max: 1_000 }),
      summary: cleanText(summary, 'Resumo', { max: 2_000 }),
      tags: normalizeTags(tags),
      status: 'PROPOSED',
      evidence: null
    };
    items.push(item);
    persist();
    return structuredClone(item);
  }

  function recordEvidence(idValue, { completedSignals, wins, losses, validationMethod, outOfSample = false, notes = null } = {}) {
    const index = items.findIndex((item) => item.id === idValue);
    if (index < 0) throw new Error('Hipótese não encontrada.');
    const total = Number(completedSignals);
    const winCount = Number(wins);
    const lossCount = Number(losses);
    if (!Number.isInteger(total) || total < 0 || !Number.isInteger(winCount) || !Number.isInteger(lossCount) || winCount + lossCount !== total) throw new Error('Evidência de resultados inválida.');

    const evidence = {
      completedSignals: total,
      wins: winCount,
      losses: lossCount,
      winRate: total ? winCount / total : null,
      validationMethod: cleanText(validationMethod, 'Método de validação', { required: true, max: 240 }),
      outOfSample: Boolean(outOfSample),
      notes: cleanText(notes, 'Notas', { max: 2_000 }),
      recordedAt: now()
    };
    const eligible = evidence.outOfSample && total >= minimumSamples;
    items[index] = { ...items[index], evidence, status: eligible ? 'VALIDATED' : 'OBSERVING' };
    persist();
    return { ...structuredClone(items[index]), promotionEligible: eligible, minimumSamples };
  }

  function setStatus(idValue, status, notes = null) {
    if (!STATUSES.has(status)) throw new Error('Status de pesquisa inválido.');
    const index = items.findIndex((item) => item.id === idValue);
    if (index < 0) throw new Error('Hipótese não encontrada.');
    if (status === 'VALIDATED') throw new Error('VALIDATED depende de evidência fora da amostra.');
    items[index] = { ...items[index], status, reviewNotes: cleanText(notes, 'Notas da revisão', { max: 2_000 }), reviewedAt: now() };
    persist();
    return structuredClone(items[index]);
  }

  return {
    add,
    recordEvidence,
    setStatus,
    list: ({ status = null } = {}) => items.filter((item) => !status || item.status === status).map((item) => structuredClone(item))
  };
}
