#!/usr/bin/env pwsh
# vitallens-rppg launcher: starts the local Node server, opens the measurement
# page in Edge (--app mode), waits for result.json, prints HR + RR.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\run-measurement.ps1
#
# Env:
#   VITALLENS_API_KEY  required — get a free key at https://www.rouast.com/api
#
# Output files (in skill root):
#   result.json   on success — raw API response + capture_meta
#   error.txt     on failure — JS stack/message from the page
#
# Exit codes:
#   0  success — HR + RR printed to stdout
#   1  preconditions failed (no key / no node / no Edge)
#   2  page reported an error (see error.txt)
#   3  timed out waiting for result (user closed the window or no signal)

$ErrorActionPreference = 'Stop'

# --- locate paths -----------------------------------------------------------
$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Definition
$root       = Split-Path -Parent $scriptDir
$serverJs   = Join-Path $scriptDir 'server.js'
$serverLog  = Join-Path $env:TEMP 'vitallens-server.log'
$serverErr  = Join-Path $env:TEMP 'vitallens-server.err'
$userDir    = Join-Path $env:LOCALAPPDATA 'vitallens-edge-profile'
$resultPath = Join-Path $root 'result.json'
$errorPath  = Join-Path $root 'error.txt'

# --- preconditions ----------------------------------------------------------
$apiKey = $env:VITALLENS_API_KEY
if (-not $apiKey) {
    Write-Error "VITALLENS_API_KEY not set. Don't relay this verbatim -- see SKILL.md `"#2 Handle missing dependencies`" and run the interactive flow with the user (ask if they have a key, get it from chat, [Environment]::SetEnvironmentVariable then restart). If unsure, point them to https://www.rouast.com/api to register."
    exit 1
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "node not found in PATH. Install Node 18+ from https://nodejs.org"
    exit 1
}
$edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) {
    $edge = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
}
if (-not (Test-Path $edge)) {
    Write-Error "Microsoft Edge not found. Install Edge -- required for --app mode."
    exit 1
}

# --- clean any stale artifacts ---------------------------------------------
Remove-Item $resultPath, $errorPath -ErrorAction SilentlyContinue
Remove-Item $serverLog, $serverErr -ErrorAction SilentlyContinue

# --- start node server, read assigned port ---------------------------------
Write-Host "Starting local server..."
$serverProc = Start-Process -FilePath 'node' `
    -ArgumentList @("`"$serverJs`"", "`"$root`"") `
    -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $serverLog `
    -RedirectStandardError  $serverErr

$port = $null
$deadline = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $deadline -and -not $port) {
    Start-Sleep -Milliseconds 200
    $content = Get-Content $serverLog -Raw -ErrorAction SilentlyContinue
    if ($content -match 'PORT=(\d+)') { $port = $matches[1] }
}
if (-not $port) {
    Write-Error "Server did not report a port within 10s. Inspect $serverErr"
    exit 1
}
Write-Host "Server listening on http://localhost:$port"

# --- launch Edge ------------------------------------------------------------
Add-Type -AssemblyName System.Web
$encodedKey = [System.Web.HttpUtility]::UrlEncode($apiKey)
$url = "http://localhost:$port/assets/vitallens-scan.html#key=$encodedKey"

if (-not (Test-Path $userDir)) {
    New-Item -ItemType Directory -Force $userDir | Out-Null
}

Write-Host "Opening measurement page in Edge..."
$edgeProc = Start-Process -FilePath $edge -ArgumentList @(
    "--app=$url",
    "--user-data-dir=`"$userDir`"",
    "--no-first-run",
    "--no-default-browser-check"
) -PassThru

# --- poll for result (or error) --------------------------------------------
Write-Host "Waiting for measurement (camera ~15s + API ~25s)..."
$pollDeadline = (Get-Date).AddSeconds(180)
while ((Get-Date) -lt $pollDeadline) {
    if (Test-Path $resultPath) { break }
    if (Test-Path $errorPath)  { break }
    Start-Sleep -Seconds 2
}

# --- cleanup browser + server ----------------------------------------------
try { Stop-Process -Id $edgeProc.Id -Force -ErrorAction SilentlyContinue } catch {}
Get-Process -Name "msedge" -ErrorAction SilentlyContinue |
    Where-Object { $_.StartTime -ge $edgeProc.StartTime } |
    Stop-Process -Force -ErrorAction SilentlyContinue
try { Stop-Process -Id $serverProc.Id -Force -ErrorAction SilentlyContinue } catch {}

# --- print result or error -------------------------------------------------
if (Test-Path $errorPath) {
    Write-Host "`n=== MEASUREMENT FAILED ===`n" -ForegroundColor Red
    Get-Content $errorPath -Raw
    exit 2
}
if (-not (Test-Path $resultPath)) {
    Write-Error "Timed out. No result.json or error.txt produced."
    exit 3
}

$json = Get-Content $resultPath -Raw | ConvertFrom-Json
$hr = $json.vitals.heart_rate
$rr = $json.vitals.respiratory_rate

Write-Host "`n=== MEASUREMENT RESULT ===`n" -ForegroundColor Green
"{0,-20} {1,8:N1} bpm   (confidence {2:N2})" -f 'Heart rate',       $hr.value, $hr.confidence | Write-Host
"{0,-20} {1,8:N1} rpm   (confidence {2:N2})" -f 'Respiratory rate', $rr.value, $rr.confidence | Write-Host
Write-Host "`nFull result: $resultPath"
Write-Host "Research use only. Not a medical device.`n" -ForegroundColor Yellow
