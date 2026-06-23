# AxAlgo — Live Strategy Performance

Public, fully transparent performance tracker for live algorithmic trading strategies.
Every trade is logged by the strategy itself and published here — win or loss.

**Live site:** _enable GitHub Pages on this repo (Settings → Pages → deploy from `main` / root)._

## How it works

```
NinjaTrader strategy (live fills only, v1.19.1+)
   └─> follow940-live-trades.csv   (in the NT8 user data dir)
            │  sync.ps1 copies it to ->
            ▼
   data/<id>.csv  ──>  build.js  ──>  data.json  ──>  index.html (static site)
```

- `build.js` — dependency-free Node script. Reads each strategy CSV listed in
  `strategies.config.json`, dedups by `TradeId`, computes stats + equity curve,
  and writes `data.json`.
- `index.html` — self-contained static page (no build step, no external deps)
  that renders `data.json`: portfolio summary, per-strategy stats, equity curves,
  and the full trade log.
- `strategies.config.json` — register each strategy here (id, name, csv, metadata).

## Update manually

```bash
node build.js          # after refreshing data/*.csv
```

Or run the full sync (copy live CSV → build → commit → push):

```powershell
./sync.ps1
```

## Add another strategy

1. Add an entry to `strategies.config.json`.
2. Drop its trade CSV (same 13-column format) into `data/<id>.csv`.
3. `node build.js`. The site auto-switches to a multi-strategy / portfolio view.

## Data format

CSV header (written by the Follow940Live v1.19.1+ NinjaScript):

```
TradeId,Date,Time (ET),Strategy,Symbol,Side,Contracts,Entry,Exit,P&L (pts),P&L ($),Reason,BiasBarRangePts
```

Only **live** fills are logged (the NinjaScript guards on `State == Realtime`).
