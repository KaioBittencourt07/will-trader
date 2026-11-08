import crypto from 'node:crypto';
import express from 'express';

const router = express.Router();
const lastIngestAt = new Map();

function safeTokenEqual(expected, provided) {
  if (typeof expected !== 'string' || typeof provided !== 'string' || !expected || !provided) return false;
  const expectedBytes = Buffer.from(expected, 'utf8');
  const providedBytes = Buffer.from(provided, 'utf8');
  return expectedBytes.length === providedBytes.length && crypto.timingSafeEqual(expectedBytes, providedBytes);
}

router.get('/avalon/status', (req, res) => {
  const feed = req.app.locals.avalonFeed;
  if (!feed) return res.status(503).json({ ok: false, error: 'AVALON_FEED_UNAVAILABLE' });
  return res.json({
    ok: true,
    relayEnabled: Boolean(process.env.WILL_AVALON_RELAY_TOKEN),
    health: feed.health()
  });
});

router.post('/avalon/ingest', (req, res) => {
  const expected = process.env.WILL_AVALON_RELAY_TOKEN;
  if (!expected) return res.status(503).json({ ok: false, error: 'AVALON_RELAY_DISABLED' });
  if (!safeTokenEqual(expected, req.get('x-will-relay-token'))) {
    return res.status(401).json({ ok: false, error: 'AVALON_RELAY_UNAUTHORIZED' });
  }

  const feed = req.app.locals.avalonFeed;
  if (!feed) return res.status(503).json({ ok: false, error: 'AVALON_FEED_UNAVAILABLE' });
  const event = req.body?.event;
  if (!event || !['timeSync', 'candle-generated'].includes(event.name)) {
    return res.status(422).json({ ok: false, error: 'AVALON_EVENT_NOT_SUPPORTED' });
  }

  const activeId = event.name === 'candle-generated' ? String(event.msg?.active_id ?? 'unknown') : 'timeSync';
  const now = Date.now();
  const lastAt = lastIngestAt.get(activeId) ?? 0;
  if (now - lastAt < 40) return res.status(429).json({ ok: false, error: 'AVALON_INGEST_RATE_LIMITED' });
  lastIngestAt.set(activeId, now);

  const result = feed.ingest(event);
  if (!result.accepted) {
    return res.status(result.ignored ? 202 : 422).json({ ok: false, ...result });
  }
  return res.status(202).json({ ok: true, ...result });
});

export default router;
