export const MARKET_INTELLIGENCE_VERSION = 'will-market-intelligence-v4';
export const CHAT_MARKET_PACKET_VERSION = 'will-chat-market-packet-v1';

const known = (status) => !['MACRO_UNKNOWN', 'NEWS_UNKNOWN', 'UNKNOWN', null, undefined].includes(status);

function sectionHealth(section = {}, label) {
  const freshness = section?.freshness?.status ?? 'UNKNOWN';
  const status = section?.status ?? `${label}_UNKNOWN`;
  const source = section?.source ?? null;
  const available = Boolean(source) && freshness === 'FRESH' && known(status);
  return Object.freeze({ label, available, status, freshness, source, blocked: Boolean(section?.blocked) });
}

function conciseEvents(events = [], limit = 5) {
  return Object.freeze((Array.isArray(events) ? events : []).slice(0, limit).map((item) => Object.freeze({
    name: item?.name ?? null,
    headline: item?.headline ?? null,
    timestamp: item?.timestamp ?? null,
    impact: item?.impact ?? 'UNKNOWN',
    source: item?.source ?? null,
    currency: item?.currency ?? null,
    currencies: Array.isArray(item?.currencies) ? Object.freeze([...item.currencies]) : Object.freeze([])
  })));
}

export function buildMarketIntelligence({ asset, marketContext = {}, generatedAt = new Date().toISOString() } = {}) {
  const macro = sectionHealth(marketContext?.macro, 'MACRO');
  const news = sectionHealth(marketContext?.news, 'NEWS');
  const hardBlocks = [];
  if (marketContext?.macro?.blocked) hardBlocks.push('MACRO_HIGH_IMPACT_WINDOW');
  if (marketContext?.news?.blocked) hardBlocks.push('NEWS_HIGH_IMPACT_WINDOW');
  const degradations = [];
  if (!macro.available) degradations.push('MACRO_CONTEXT_UNAVAILABLE_OR_STALE');
  if (!news.available) degradations.push('NEWS_CONTEXT_UNAVAILABLE_OR_STALE');

  const coverage = macro.available && news.available
    ? 'FULL'
    : macro.available || news.available
      ? 'PARTIAL'
      : 'UNKNOWN';

  return Object.freeze({
    version: MARKET_INTELLIGENCE_VERSION,
    generatedAt,
    asset: asset ?? marketContext?.asset ?? null,
    coverage,
    decisionPolicy: Object.freeze({
      directionalAuthority: 'WILL_DETERMINISTIC_CORE',
      contextRole: 'RISK_FILTER_AND_EXPLANATION_ONLY',
      aiMayCreateDirection: false,
      unknownContextIsSafe: false,
      ordersExecuted: 0
    }),
    macro: Object.freeze({
      ...macro,
      reason: marketContext?.macro?.reason ?? null,
      events: conciseEvents(marketContext?.macro?.events)
    }),
    news: Object.freeze({
      ...news,
      reason: marketContext?.news?.reason ?? null,
      events: conciseEvents(marketContext?.news?.events)
    }),
    hardBlocked: hardBlocks.length > 0,
    hardBlocks: Object.freeze(hardBlocks),
    degradations: Object.freeze(degradations),
    decisionImpact: hardBlocks.length > 0 ? 'BLOCK_ANALYSIS_RELEASE' : 'CONTEXT_ONLY',
    ordersExecuted: 0
  });
}

export function buildChatMarketPacket({ asset, marketContext = {}, scanner = null, learning = null, generatedAt = new Date().toISOString() } = {}) {
  const intelligence = buildMarketIntelligence({ asset, marketContext, generatedAt });
  return Object.freeze({
    version: CHAT_MARKET_PACKET_VERSION,
    generatedAt,
    asset: intelligence.asset,
    instructions: Object.freeze([
      'USE_ONLY_STRUCTURED_FIELDS_PROVIDED',
      'DO_NOT_INVENT_MARKET_FACTS',
      'DO_NOT_CREATE_BUY_OR_SELL_DIRECTION',
      'TREAT_UNKNOWN_CONTEXT_AS_UNKNOWN',
      'EXPLAIN_HARD_BLOCKS_AND_DEGRADATIONS'
    ]),
    intelligence,
    scanner: scanner ? structuredClone(scanner) : null,
    learning: learning ? structuredClone(learning) : null,
    intendedConsumers: Object.freeze(['DASHBOARD', 'MARKET_CHAT', 'AI_AUDIT', 'DAILY_BRIEF']),
    decisionImpact: 'EXPLANATION_ONLY',
    ordersExecuted: 0
  });
}
