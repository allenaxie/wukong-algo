# axalgo (Wukong Algo website) — working protocol

Public, fully-transparent performance site. Local folder `~/axalgo`; repo `allenaxie/wukong-algo`; served via **GitHub Pages (main / root)** at https://allenaxie.github.io/wukong-algo/. `README.md` has the fuller narrative; **this file is the operational standard — follow it.**

## Pipeline
NinjaTrader live CSV → `data/<id>.csv` → `build.js` → `data.json` → `index.html` (single self-contained static page that fetches `data.json`). Register strategies in `strategies.config.json`. `sync.ps1` copies live CSVs, rebuilds, commits, and pushes — gated on `data/` changes so it doesn't push no-op rebuilds.

## Brand guard (non-negotiable)
The live tracker, hero, and portfolio aggregate render **LIVE FILLS ONLY** — never backtest data. The site's promise is *"no curve-fit backtests."* Backtest figures appear **only** on the Strategy Lineup cards and are always labeled as backtest. Keep these two worlds separate.

## Strategy Lineup
Status-badged cards (`live` / `forward-test` / `backtest`) per strategy, each with its active-version backtest summary + a "View full backtest" accordion. Backtest summaries are read from the sibling `../trading-strategies/` repo at build time (config `backtest` = relative path). **Do not copy backtest CSVs into this repo** — only `data.json` is published.

## Metric standards
- **Headline metric = profit/month**, never net (net isn't comparable across different date ranges).
- **Normalize every dollar figure to ONE contract** via each strategy's `backtestContracts` (Follow940 backtest runs at 2 contracts, others at 1). Ratios / percentages / counts (PF, win rate, Sharpe…) are size-invariant — leave them. Verify a strategy's contract size from its `trades.csv` Qty column when adding it.
- **No version numbers shown publicly** (kept internal in the changelogs).

## Live tracker (multi-strategy)
The per-strategy view switcher (`renderPerf` over `[Portfolio, ...each live strategy]`) auto-appears once **2+** strategies are live — hidden for one. Per-strategy `stats`/`equity`/`trades` are already emitted to `data.json`. Portfolio stays the default headline; the top hero is always the portfolio.

## When a strategy graduates to live
Flip its `status` to `live` in `strategies.config.json` and point `csv` at its live trade file — the tracker becomes multi-strategy with no further UI work. To update a backtest baseline, re-point its `backtest` path and rebuild (note: `sync.ps1` won't auto-republish a backtest-only change since it gates on `data/`).

## Verify before shipping
After editing `build.js`/`index.html`, run `node build.js` and syntax-check the page script (`node --check`). The page script can be executed against `data.json` in a mocked DOM to confirm rendering.

## Commit / push
Commit or push **only when asked**. Pages serves from `main`/root, so commit to `main`. End commit messages with the `Co-Authored-By: Claude` line.
