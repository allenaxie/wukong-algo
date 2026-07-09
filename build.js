#!/usr/bin/env node
/*
 * Wukong Algo site build — reads each strategy's live-trade CSV and emits data.json.
 *
 * Pipeline:  NinjaTrader live CSV  ->  data/<id>.csv  ->  build.js  ->  data.json
 *
 * - Dependency-free (Node built-ins only).
 * - Dedups by TradeId (defensive; the v1.19.1 NinjaScript already writes live-only).
 * - Computes per-strategy + portfolio stats and equity curves.
 * - Designed for many strategies; today there's just Follow940.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const CONFIG = path.join(ROOT, 'strategies.config.json');
const OUT = path.join(ROOT, 'data.json');

const MONTHS = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5,
                 Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };

// "23 Jun 2026" + "10:30:00" -> Date (used only for sorting; tz-agnostic)
function parseWhen(dateStr, timeStr) {
  const [d, mon, y] = String(dateStr).trim().split(/\s+/);
  const [hh = '0', mm = '0', ss = '0'] = String(timeStr || '').trim().split(':');
  return new Date(Date.UTC(+y, MONTHS[mon] ?? 0, +d, +hh, +mm, +ss));
}

function parseCsv(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const lines = raw.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length === 0) return [];
  const header = lines[0].split(',').map(h => h.trim());
  const idx = name => header.indexOf(name);
  const col = {
    tradeId: idx('TradeId'), date: idx('Date'), time: idx('Time (ET)'),
    side: idx('Side'), contracts: idx('Contracts'),
    entry: idx('Entry'), exit: idx('Exit'),
    pnlPts: idx('P&L (pts)'), pnl: idx('P&L ($)'), reason: idx('Reason'),
  };
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    if (c.length < header.length) continue;
    const date = c[col.date], time = c[col.time];
    rows.push({
      tradeId: col.tradeId >= 0 ? c[col.tradeId] : `${date} ${time} ${c[col.side]}`,
      date, time,
      side: c[col.side],
      contracts: +c[col.contracts] || 0,
      entry: +c[col.entry], exit: +c[col.exit],
      pnlPts: +c[col.pnlPts],
      pnl: +c[col.pnl],
      reason: col.reason >= 0 ? c[col.reason] : '',
      _when: parseWhen(date, time),
    });
  }
  return rows;
}

function round(n, p = 2) { const f = 10 ** p; return Math.round(n * f) / f; }

function computeStats(trades) {
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl < 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);

  // Equity curve + max drawdown over cumulative $ P&L.
  let cum = 0, peak = 0, maxDd = 0;
  const equity = [{ i: 0, date: null, pnl: 0, cum: 0 }];
  trades.forEach((t, i) => {
    cum += t.pnl;
    peak = Math.max(peak, cum);
    maxDd = Math.max(maxDd, peak - cum);
    equity.push({ i: i + 1, date: t.date, pnl: round(t.pnl), cum: round(cum) });
  });

  return {
    stats: {
      trades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: trades.length ? round((wins.length / trades.length) * 100, 1) : 0,
      totalPnl: round(totalPnl),
      avgTrade: trades.length ? round(totalPnl / trades.length) : 0,
      avgWin: wins.length ? round(grossProfit / wins.length) : 0,
      avgLoss: losses.length ? round(-grossLoss / losses.length) : 0,
      profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : (grossProfit > 0 ? null : 0),
      grossProfit: round(grossProfit),
      grossLoss: round(grossLoss),
      maxDrawdown: round(maxDd),
      bestTrade: trades.length ? round(Math.max(...trades.map(t => t.pnl))) : 0,
      worstTrade: trades.length ? round(Math.min(...trades.map(t => t.pnl))) : 0,
      firstDate: trades.length ? trades[0].date : null,
      lastDate: trades.length ? trades[trades.length - 1].date : null,
    },
    equity,
  };
}

// --- NinjaTrader "Performance summary" CSV --------------------------------
// These exports are  Performance,All trades,Long trades,Short trades  then
// rows of  Label,value,value,value  (with blank separator lines). We read the
// "All trades" column (index 1). Values are NinjaTrader-formatted strings.
// All backtest summaries are run per ONE contract.

// "$1,234.50" -> 1234.5 ; "($1,234.50)" -> -1234.5 ; "35.84%" -> 35.84 ; "" -> null
function numFromSummary(v) {
  if (v == null) return null;
  let s = String(v).trim();
  if (s === '') return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s);
  s = s.replace(/[^0-9.]/g, '');
  if (s === '' || s === '.') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : (neg ? -n : n);
}

// Pretty-print money cells for the detail table, normalized to one contract:
// "$34706.00" /2 -> "$17,353.00", "($22769.00)" /2 -> "-$11,384.50". Non-money
// cells (%, ratios, counts, min/days) pass through untouched.
function fmtCell(v, contracts) {
  const c = contracts || 1;
  const s = String(v == null ? '' : v).trim();
  if (/^\(?-?\$/.test(s)) {
    const neg = /^\(/.test(s) || /^-/.test(s);
    const n = parseFloat(s.replace(/[^0-9.]/g, ''));
    if (!isNaN(n)) {
      return (neg ? '-$' : '$') + (n / c).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  }
  return s;
}

// Average drawdown from a NinjaTrader trades export ("Cum. net profit" column).
// NinjaTrader's summary reports Max. drawdown but not average drawdown, so we
// derive it from the closed-trade equity curve. "Average drawdown" here = the
// mean depth of each distinct peak-to-trough drawdown episode (a new equity high
// starts a fresh episode). Returned normalized to ONE contract, matching every
// other dollar figure on the site. Returns null if the file/column is missing.
function avgDrawdownFromTrades(file, contracts) {
  if (!file || !fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const lines = raw.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) return null;
  const header = lines[0].split(',').map(h => h.trim());
  const ci = header.findIndex(h => /^cum/i.test(h)); // "Cum. net profit"
  if (ci < 0) return null;

  let peak = 0, epMax = 0;
  const episodes = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    if (cells.length <= ci) continue;
    const cum = numFromSummary(cells[ci]); // handles "$1,234.50" / "($1,234.50)"
    if (cum == null) continue;
    if (cum > peak) {                 // new equity high — close any open episode
      peak = cum;
      if (epMax > 0) { episodes.push(epMax); epMax = 0; }
    } else {
      epMax = Math.max(epMax, peak - cum);
    }
  }
  if (epMax > 0) episodes.push(epMax);
  if (episodes.length === 0) return 0;
  const mean = episodes.reduce((s, d) => s + d, 0) / episodes.length;
  return round(mean / (contracts || 1));
}

function parseSummary(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const map = {};
  raw.split(/\r?\n/).forEach(line => {
    if (!line.trim()) return;
    const c = line.split(',');
    const label = (c[0] || '').trim();
    if (!label || label === 'Performance') return;
    map[label] = (c[1] || '').trim(); // "All trades" column
  });
  return map;
}

// All dollar figures are normalized to ONE contract so strategies backtested
// at different sizes (Follow940 @ 2, others @ 1) are directly comparable.
function buildBacktest(map, contracts, avgDrawdown) {
  const c = contracts || 1;
  const g = k => (map[k] !== undefined ? map[k] : null);
  const perC = k => { const n = numFromSummary(g(k)); return n == null ? null : round(n / c); };
  const startY = String(g('Start date') || '').split('/').pop();
  const endY = String(g('End date') || '').split('/').pop();

  // Curated rows for the "View full backtest" accordion (NinjaTrader detail).
  const detailKeys = [
    ['Profit factor', 'Profit factor'],
    ['Total net profit', 'Net profit'],
    ['Profit per month', 'Profit / month'],
    ['Percent profitable', 'Win rate'],
    ['Total # of trades', 'Total trades'],
    ['Avg. trade', 'Avg. trade'],
    ['Ratio avg. win / avg. loss', 'Avg win / avg loss'],
    ['Avg. winning trade', 'Avg. winning trade'],
    ['Avg. losing trade', 'Avg. losing trade'],
    ['Max. drawdown', 'Max drawdown'],
    ['Sharpe ratio', 'Sharpe ratio'],
    ['Sortino ratio', 'Sortino ratio'],
    ['Max. consec. winners', 'Max consec. winners'],
    ['Max. consec. losers', 'Max consec. losers'],
    ['Largest winning trade', 'Largest win'],
    ['Largest losing trade', 'Largest loss'],
    ['Avg. # of trades per day', 'Avg trades / day'],
    ['Avg. MAE', 'Avg MAE'],
    ['Avg. MFE', 'Avg MFE'],
    ['Avg. ETD', 'Avg ETD'],
  ];
  const detail = detailKeys
    .filter(([k]) => g(k) != null && g(k) !== '')
    .map(([k, label]) => ({ label, value: fmtCell(map[k], c) }));

  // Insert derived "Avg drawdown" right after "Max drawdown" (not in the NT summary).
  if (avgDrawdown != null) {
    const at = detail.findIndex(r => r.label === 'Max drawdown');
    const row = { label: 'Avg drawdown', value: '-' + fmtCell('$' + avgDrawdown, 1) };
    detail.splice(at >= 0 ? at + 1 : detail.length, 0, row);
  }

  return {
    perContract: true,
    period: (startY && endY) ? (startY + ' – ' + endY) : null,
    profitPerMonth: perC('Profit per month'), // $ — normalized to 1 contract
    profitFactor: numFromSummary(g('Profit factor')),       // ratio — size-invariant
    winRate: numFromSummary(g('Percent profitable')),       // % — size-invariant
    maxDrawdown: perC('Max. drawdown'),       // $ — normalized to 1 contract
    avgDrawdown: avgDrawdown == null ? null : round(avgDrawdown), // $ — normalized to 1 contract
    netProfit: perC('Total net profit'),      // $ — normalized to 1 contract
    trades: numFromSummary(g('Total # of trades')),         // count — size-invariant
    winLossRatio: numFromSummary(g('Ratio avg. win / avg. loss')), // ratio — size-invariant
    detail,
  };
}

function main() {
  const config = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  const strategies = []; // live track record (drives the performance section)
  const lineup = [];     // every strategy + its active-version backtest summary
  let allTrades = [];

  for (const s of config.strategies) {
    // ---- Live track record: only strategies with a present live CSV ----
    if (s.csv) {
      const csvPath = path.join(DATA_DIR, s.csv);
      if (fs.existsSync(csvPath)) {
        // parse, dedup by tradeId, sort chronologically
        const seen = new Set();
        const trades = parseCsv(csvPath)
          .filter(t => (seen.has(t.tradeId) ? false : (seen.add(t.tradeId), true)))
          .sort((a, b) => a._when - b._when);

        const { stats, equity } = computeStats(trades);
        strategies.push({
          id: s.id, name: s.name, type: s.type, tf: s.tf,
          style: s.style, status: s.status || 'live', description: s.description || '',
          stats, equity,
          trades: trades.map(t => ({
            tradeId: t.tradeId, date: t.date, time: t.time, side: t.side,
            contracts: t.contracts, entry: t.entry, exit: t.exit,
            pnlPts: round(t.pnlPts), pnl: round(t.pnl), reason: t.reason,
          })),
        });
        allTrades = allTrades.concat(trades);
        console.log(`✓ live ${s.id}: ${trades.length} trades, net $${round(stats.totalPnl)}`);
      } else {
        console.warn(`! ${s.id}: live csv ${s.csv} not found — no live data`);
      }
    }

    // ---- Strategy lineup: backtest summary for the active version ----
    if (s.backtest) {
      const btPath = path.resolve(ROOT, s.backtest);
      if (fs.existsSync(btPath)) {
        const btTradesPath = s.backtestTrades ? path.resolve(ROOT, s.backtestTrades) : null;
        const avgDd = avgDrawdownFromTrades(btTradesPath, s.backtestContracts);
        const backtest = buildBacktest(parseSummary(btPath), s.backtestContracts, avgDd);
        lineup.push({
          id: s.id, name: s.name, type: s.type, tf: s.tf,
          style: s.style, status: s.status || 'backtest', description: s.description || '',
          backtest,
        });
        console.log(`✓ backtest ${s.id}: $${backtest.profitPerMonth}/mo, PF ${backtest.profitFactor}`);
      } else {
        console.warn(`! ${s.id}: backtest summary not found at ${s.backtest}`);
      }
    }
  }

  allTrades.sort((a, b) => a._when - b._when);
  const portfolio = computeStats(allTrades); // live fills only

  const out = {
    generated: new Date().toISOString(),
    portfolio: { stats: portfolio.stats, equity: portfolio.equity },
    strategies,
    lineup,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`\nWrote ${path.relative(ROOT, OUT)} — ${strategies.length} live, ${lineup.length} in lineup, portfolio net $${round(portfolio.stats.totalPnl)}`);
}

main();
