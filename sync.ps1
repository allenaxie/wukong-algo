# Wukong Algo sync — copy live CSV(s) -> rebuild data.json -> commit & push.
# Intended to be run by a scheduled task (hourly, weekdays). Safe to run by hand.
#
# Only publishes when a SOURCE trade CSV actually changes. data.json carries a
# "generated" timestamp that changes every build, so we gate on data/ (the CSVs),
# not on data.json — otherwise every run would push a no-op commit.
$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$env:Path += ";C:\Users\Administrator\tools\bin"   # gh on PATH for git auth
Set-Location $repo

# Map each strategy's live NinjaTrader CSV -> its file under data\.
$sources = @{
  "C:\Users\Administrator\Documents\NinjaTrader 8\Follow940Live\follow940-live-trades.csv" = "data\follow940.csv"
}
foreach ($src in $sources.Keys) {
  if (Test-Path $src) {
    Copy-Item $src (Join-Path $repo $sources[$src]) -Force
  } else {
    Write-Warning "Live CSV not found: $src"
  }
}

# Did any source CSV change vs what's committed? (ignores data.json timestamp churn)
$csvChanged = git status --porcelain -- data
if (-not $csvChanged) {
  Write-Host "No new trades; nothing to publish."
  exit 0
}

# Real data change -> rebuild and publish.
node build.js
git add data data.json
git commit -m ("data: auto-update {0:yyyy-MM-dd HH:mm} ET" -f (Get-Date)) | Out-Null
git push origin main
Write-Host "Pushed updated performance data."
