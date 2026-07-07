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
}
foreach ($src in $sources.Keys) {
  if (Test-Path $src) {
    Copy-Item $src (Join-Path $repo $sources[$src]) -Force
  } else {
    Write-Warning "Live CSV not found: $src"
  }
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
