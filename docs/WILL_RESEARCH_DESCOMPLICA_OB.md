# WILL Research Source — Descomplica OB

Source: https://www.youtube.com/@descomplicaob6037

## Role in WILL

Descomplica OB is a research-only educational source. It does not become a market-data provider, temporal authority, macro/news authority, signal source, or production decision gate.

The channel is useful for extracting operator hypotheses about price action and discretionary chart reading. Any idea taken from the channel must be translated into explicit, testable features before it can influence the Learning Lab or a challenger strategy.

## Themes observed from the channel

Public channel metadata and recent video titles emphasize:

- price action and chart reading;
- support and resistance, including M1 examples;
- pullbacks;
- candle reading;
- candle wicks/pavios;
- command candles / velas de comando;
- entry triggers and filters;
- trade management and discipline.

These topics map naturally to the current WILL feature layer, especially structure, setup formation, candle anatomy, rejection, breakout/pullback behavior, timing and confirmation count.

## Research hypotheses to extract

The following are hypotheses to test, not accepted truths:

1. Wick rejection: long wick relative to candle body/range may indicate rejection at a level.
2. Support/resistance reaction: repeated reactions around recent swing zones may improve setup quality.
3. Pullback quality: retracement depth and reaction after breakout/trend continuation may separate stronger from weaker entries.
4. Command candle: large directional candle with favorable body-to-range ratio and location may contain information about short-term impulse.
5. Trigger confirmation: the quality of a setup may depend on a combination of structure + candle reaction + timing, rather than one indicator.
6. Range change: change in recent high/low structure may signal regime transition and should be measured rather than interpreted loosely.

## Translation into quantitative features

Candidate research features for offline implementation:

- wickUpperPct / wickLowerPct;
- bodyPctOfRange;
- candleRangeVsATR / recent median range;
- closeLocationValue;
- distanceToRecentSwingHigh / swingLow;
- touchesAtSupport / touchesAtResistance;
- breakoutDistance;
- pullbackDepthPct;
- barsSinceBreakout;
- rejectionAfterBreakout;
- impulseCandleFlag;
- commandCandleScore;
- sameDirectionFollowThrough;
- falseBreakFlag;
- structureShiftFlag;
- setupConfluenceCount.

All features must use closed canonical candles only.

## Validation policy

No claim such as “never fails”, “20 wins”, “double the account”, “most profitable strategy”, or an implied high hit rate is accepted as evidence.

Before a concept can affect production:

1. define it mathematically;
2. add deterministic unit tests;
3. replay against historical/canonical closed-candle samples;
4. run prospective evidence collection;
5. segment WIN/LOSS by feature/setup version;
6. compare against the current baseline out-of-sample;
7. promote only with manual/guarded approval.

## Relationship with the WILL channel

The WILL channel and Descomplica OB should be treated as independent educational inputs. Agreement between channels can increase research priority, but does not count as statistical confirmation.

The correct flow is:

`channel idea -> research hypothesis -> deterministic feature -> offline replay -> prospective evidence -> Learning Lab -> challenger -> possible guarded promotion`

## Safety / production boundary

- no YouTube claim can bypass Market Admission;
- no educational pattern can bypass temporal/freshness gates;
- no source can create automatic broker execution;
- no threshold is relaxed to reproduce a video result;
- discretionary examples are never counted as audited WIN/LOSS evidence;
- all production influence remains versioned and measurable.
