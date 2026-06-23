# AxAlgo sync — copy live CSV(s) -> rebuild data.json -> commit & push.
# Intended to be run by a scheduled task (e.g. hourly). Safe to run by hand.
$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$env:Path += ";C:\Users\Administrator\tools\bin"   # gh on PATH for git auth

# 1. Pull the latest live trade log(s) from NinjaTrader's user data dir.
$liveCsv = "C:\Users\Administrator\Documents\NinjaTrader 8\Follow940Live\follow940-live-trades.csv"
if (Test-Path $liveCsv) {
  Copy-Item $liveCsv (Join-Path $repo 'data\follow940.csv') -Force
} else {
  Write-Warning "Live CSV not found: $liveCsv"
}

# 2. Rebuild data.json.
Set-Location $repo
node build.js

# 3. Commit & push only if something changed.
git add data.json data\*.csv
$changed = git status --porcelain data.json data\*.csv
if ($changed) {
  git commit -m ("data: auto-update {0:yyyy-MM-dd HH:mm} ET" -f (Get-Date)) | Out-Null
  git push origin main
  Write-Host "Pushed updated performance data."
} else {
  Write-Host "No data changes; nothing to push."
}
