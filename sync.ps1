# Wukong Algo sync — copy live CSV(s) -> rebuild data.json -> commit & push.
# Intended to be run by a scheduled task (hourly, weekdays). Safe to run by hand.
#
# Publishes when EITHER:
#   (a) a live trade CSV changed (new live fills), OR
#   (b) data.json's substantive content changed — e.g. a strategy's active-version
#       backtest summary was updated in the sibling ../trading-strategies repo
#       (build.js reads those at build time; they never touch data\ here).
# data.json carries a "generated" timestamp that changes every build, so we compare
# data.json with that line ignored — otherwise every run would push a no-op commit.
$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$env:Path += ";C:\Users\Administrator\tools\bin"   # gh on PATH for git auth
Set-Location $repo

# Map each strategy's live NinjaTrader CSV -> its file under data\.
$sources = @{
  "C:\Users\Administrator\Documents\NinjaTrader 8\Follow940Live\follow940-live-trades.csv" = "data\follow940.csv"
  "C:\Users\Administrator\Documents\NinjaTrader 8\CCORBStrategyActive\ccorb-active-trades.csv" = "data\ccorb.csv"
  # CCORB-MGC went live 2026-08-25; its exporter ships in ACTIVE-1.9.1. The file does not exist
  # until its first live fill, so the Test-Path branch below just warns until then.
  "C:\Users\Administrator\Documents\NinjaTrader 8\CCORBStrategyMGCActive\ccorbmgc-active-trades.csv" = "data\ccorbmgc.csv"
}
foreach ($src in $sources.Keys) {
  if (Test-Path $src) {
    Copy-Item $src (Join-Path $repo $sources[$src]) -Force
  } else {
    Write-Warning "Live CSV not found: $src"
  }
}

# Paused strategies ("status": "paused" + "pausedOn" in strategies.config.json) keep running on a
# NinjaTrader Sim account after pausedOn. Their live CSV has no account column, so a sim fill looks
# exactly like a live one: keep only rows dated BEFORE pausedOn, so sim fills never reach data\ (or
# the public repo). Date is column 2, "dd MMM yyyy". UTF-8 without BOM and LF endings are preserved
# (the Reason column carries emoji; PowerShell 5.1's Get-/Set-Content would mangle them). An
# unparseable date throws, and that stops the sync before anything is published.
$utf8 = New-Object System.Text.UTF8Encoding($false)
$inv  = [Globalization.CultureInfo]::InvariantCulture
$config = [IO.File]::ReadAllText((Join-Path $repo 'strategies.config.json'), $utf8) | ConvertFrom-Json
foreach ($s in $config.strategies) {
  if ($s.status -ne 'paused' -or -not $s.pausedOn -or -not $s.csv) { continue }
  $dst = Join-Path $repo (Join-Path 'data' $s.csv)
  if (-not (Test-Path $dst)) { continue }
  $cut   = [datetime]::ParseExact($s.pausedOn, 'yyyy-MM-dd', $inv)
  $lines = [IO.File]::ReadAllLines($dst, $utf8)
  $keep  = @($lines[0]) + @($lines | Select-Object -Skip 1 | Where-Object {
    $_ -ne '' -and [datetime]::ParseExact(($_ -split ',')[1].Trim(), 'dd MMM yyyy', $inv) -lt $cut
  })
  [IO.File]::WriteAllText($dst, (($keep -join "`n") + "`n"), $utf8)
  Write-Host ("Paused {0}: kept {1} of {2} rows dated before {3}" -f $s.id, ($keep.Count - 1), ($lines.Count - 1), $s.pausedOn)
}

# Rebuild first so backtest-summary changes (sourced from ../trading-strategies)
# are reflected in data.json before we decide whether to publish.
node build.js

$csvChanged = git status --porcelain -- data           # live fills changed?

# Substantive data.json change = any added/removed diff line OTHER than the
# volatile "generated" timestamp. git's diff already normalizes line endings,
# so this is robust to CRLF/LF churn.
$jsonChanged = [bool](
  git --no-pager diff --unified=0 -- data.json |
    Where-Object { $_ -match '^[+-]' -and $_ -notmatch '^(\+\+\+|---)' -and $_ -notmatch '"generated"' }
)

if (-not $csvChanged -and -not $jsonChanged) {
  # Only the build timestamp moved — discard the churn, publish nothing.
  git checkout -- data.json
  Write-Host "No live or backtest changes; nothing to publish."
  exit 0
}

# Real change -> publish.
$reason = if ($csvChanged) { if ($jsonChanged) { "live + backtest" } else { "live trades" } } else { "backtest update" }
git add data data.json
git commit -m ("data: auto-update ({0}) {1:yyyy-MM-dd HH:mm} ET" -f $reason, (Get-Date)) | Out-Null
git push origin main
Write-Host "Pushed updated performance data ($reason)."
