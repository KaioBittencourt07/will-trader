# Market Access & Avalon Universe Gate

PAPER research and Avalon execution are separate gates. Prospective PAPER
research needs verified provider data; it does not need an Avalon catalog.
Avalon mapping is still mandatory before any future claim of availability or
manual execution there.

## Avalon Universe Gate

Set `AVALON_ALLOWLIST_FILE` to a local JSON export. The application reads this
file only; it never writes it, logs into Avalon, scrapes a catalog, or treats a
Twelve Data symbol as proof of broker availability.

```json
{
  "version": "avalon-allowlist-v1",
  "source": "Kaio manual platform export",
  "verifiedAt": "2026-09-03T12:00:00.000Z",
  "assets": [
    {
      "asset": "EXACT_ASSET_FROM_AVALON",
      "brokerSymbol": "EXACT_AVALON_SYMBOL",
      "source": "Kaio manual platform export",
      "verifiedAt": "2026-09-03T12:00:00.000Z",
      "status": "TRADABLE",
      "expiresAt": "2026-09-04T12:00:00.000Z"
    }
  ]
}
```

The exact values above are placeholders, not a catalog. Every entry needs its
own asset, broker symbol, source, timestamp and status. The file is invalid if
missing, malformed, duplicated, unverified, future-dated or expired. Without
an explicit `expiresAt`, an entry expires after 24 hours (or the configured
`AVALON_CATALOG_MAX_AGE_MS`). In all invalid states the operational scanner
remains fail-closed with `AVALON_CATALOG_UNVERIFIED`.

## Twelve Data Gate

On Kaio's computer, with the backend running and the real Twelve Data key in
the local environment, call:

`GET /api/market/diagnostic?asset=EUR%2FUSD&timeframe=1min`

The response is diagnostic-only and uses the existing cache/rate limiter. It
reports `HEALTHY`, `CREDENTIAL_ERROR`, `RATE_LIMITED`, `NETWORK_BLOCKED`,
`INVALID_RESPONSE`, `STALE_DATA` or `UNKNOWN_ERROR`. `HEALTHY` requires an
actual valid snapshot; the endpoint never fabricates data. It does not start a
batch, create an order, or contact Avalon.

## Launch condition

Do not start prospective PAPER collection until a real `HEALTHY` market
diagnostic is recorded. The canonical market universe is research-only and is
not evidence that any symbol exists on Avalon. A current verified Avalon
allowlist remains required for any future manual execution mapping or
availability statement. PAPER/MANUAL remains mandatory; there is no Avalon
click, order, payout or real-money flow in this gate.

