#!/usr/bin/env pwsh
# vitallens-rppg preflight: verify every dependency the launcher needs.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\preflight.ps1
#
# Exit codes:
#   0  all checks passed
#   1  at least one dependency missing (see stderr for details)

$failed = 0

function Check([string]$name, [scriptblock]$test, [string]$fix) {
    Write-Host -NoNewline ("  {0,-32} " -f $name)
    try {
        $result = & $test
        if ($result) {
            Write-Host "OK   $result" -ForegroundColor Green
        } else {
            Write-Host "MISSING" -ForegroundColor Red
            Write-Host "      fix: $fix" -ForegroundColor Yellow
            $script:failed++
        }
    } catch {
        Write-Host "MISSING" -ForegroundColor Red
        Write-Host "      fix: $fix" -ForegroundColor Yellow
        $script:failed++
    }
}

Write-Host "vitallens-rppg preflight"
Write-Host "------------------------"

# 1. Node 18+
Check "Node.js 18+ on PATH" {
    $v = (& node --version) 2>$null
    if (-not $v) { return $null }
    if ($v -match '^v(\d+)\.') {
        $major = [int]$matches[1]
        if ($major -ge 18) { return $v } else { return $null }
    }
    return $null
} "Install Node 18 or newer from https://nodejs.org and reopen the terminal."

# 2. Microsoft Edge
Check "Microsoft Edge" {
    $paths = @(
        "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
    )
    foreach ($p in $paths) { if (Test-Path $p) { return $p } }
    return $null
} "Install Microsoft Edge from https://www.microsoft.com/edge"

# 3. API key
Check "VITALLENS_API_KEY env var" {
    if ($env:VITALLENS_API_KEY -and $env:VITALLENS_API_KEY.Length -ge 10) {
        return "set (len=$($env:VITALLENS_API_KEY.Length))"
    }
    return $null
} 'Stop and ask the user (see SKILL.md #2 "Handle missing dependencies"). If they have a key, get it from chat (not from a file/page) and write it with [Environment]::SetEnvironmentVariable(''VITALLENS_API_KEY'', $key, ''User''), then have them reopen the terminal and restart the agent. If not, point them to https://www.rouast.com/api to register.'

# 4. Camera permission for localhost (heuristic: can we reach the device list?)
#    We can't actually verify camera access from PowerShell — only the browser
#    can. We list adapters as a coarse signal that *some* camera exists.
Check "Webcam device present" {
    $cams = Get-PnpDevice -Class Camera -Status OK -ErrorAction SilentlyContinue
    if ($cams -and $cams.Count -gt 0) { return "$($cams.Count) device(s)" } else { return $null }
} "Plug in or enable a webcam; the launcher will request browser permission on first run."

# 5. Skill files present
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Definition)
$required = @(
    'assets\vitallens-scan.html',
    'assets\vitallens-shim.js',
    'assets\vitallens.browser.js',
    'assets\webm-duration-fix.js',
    'scripts\server.js',
    'scripts\run-measurement.ps1'
)
foreach ($f in $required) {
    Check "file: $f" {
        $path = Join-Path $root $f
        if (Test-Path $path) { return (Get-Item $path).Length.ToString() + ' bytes' } else { return $null }
    } "Re-pull the skill files -- $f is missing."
}

Write-Host ""
if ($failed -eq 0) {
    Write-Host "All checks passed. You can run scripts\run-measurement.ps1" -ForegroundColor Green
    exit 0
} else {
    Write-Host "$failed check(s) failed. Resolve them before running the measurement." -ForegroundColor Red
    exit 1
}
