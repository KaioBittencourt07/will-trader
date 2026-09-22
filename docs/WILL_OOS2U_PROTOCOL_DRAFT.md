# WILL Edge Gate OOS-2U — protocol draft

OOS-2U is an unactivated prospective successor. This draft creates no freeze, campaign ID, edge cut, evidence directory, runtime, or collection.

Its statistical contract remains unchanged: `MeanAbsMomentum <= 0.599936`, exactly the first 50 durable candidate cycles, replacement `NONE`, cycle-cluster bootstrap with 10,000 deterministic replications, no retuning, no early stopping, no automatic LIVE promotion, and financial expectancy `NOT_AVAILABLE` without frozen payout/costs.

The operational mode is `PAPER_READ_ONLY`. Only `PAPER_CONFIRMED` records settled by `paper-outcome-settlement-v2` from `paper-live-temporal-reference-v1` are official outcomes. `DATA_INVALID` and `OPERATIONAL_FAILURE` retain their slots but are excluded from performance.

OOS-2U adds `PROTECTED_PROSPECTIVE_MUTATION_ISOLATION`: records carrying exact evidence membership under a WILL OOS-2 protocol cannot be confirmed or settled by manual/generic storage or API paths. Only the dedicated PAPER entry and settlement authority may mutate them. Manual history projection excludes them as an additional UX safeguard.

Activation remains unauthorized until a separate reviewed freeze pins a new campaign identity, edge cut, baseline commitments, evidence directory, and source commit.
