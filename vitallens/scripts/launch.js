#!/usr/bin/env node
// vitallens-rppg cross-platform launcher
//
// Single entry point: starts local server, opens Chromium browser with
// auto-granted camera permission, waits for result, prints HR + RR.
//
// Usage:
//   node scripts/launch.js
//
// Env:
//   VITALLENS_API_KEY  required — free key at https://www.rouast.com/api
//
// Exit codes:
//   0  success
//   1  preconditions failed
//   2  page reported an error or timed out

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const RESULT_PATH = path.join(ROOT, 'result.json');
const ERROR_PATH = path.join(ROOT, 'error.txt');
const POLL_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 1500;

// ─── Preflight ────────────────────────────────────────────────────────────────

function log(msg) { process.stdout.write(msg + '\n'); }
function err(msg) { process.stderr.write('ERROR: ' + msg + '\n'); }

function checkNode() {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 18) {
    err(`Node.js 18+ required (current: v${process.versions.node}). Update from https://nodejs.org`);
    return false;
  }
  return true;
}

function checkApiKey() {
  if (!process.env.VITALLENS_API_KEY || process.env.VITALLENS_API_KEY.length < 10) {
    err('VITALLENS_API_KEY environment variable not set or too short.');
    err('Get a free key at https://www.rouast.com/api then set it:');
    if (os.platform() === 'win32') {
      err('  [Environment]::SetEnvironmentVariable("VITALLENS_API_KEY", "<key>", "User")');
    } else {
      err('  export VITALLENS_API_KEY="<key>"  (add to ~/.bashrc or ~/.zshrc)');
    }
    return false;
  }
  return true;
}

function checkSkillFiles() {
  const required = [
    'assets/vitallens-scan.html',
    'assets/vitallens.browser.js',
    'assets/webm-duration-fix.js',
    'scripts/server.js',
  ];
  for (const f of required) {
    if (!fs.existsSync(path.join(ROOT, f))) {
      err(`Missing file: ${f} — re-pull the skill files.`);
      return false;
    }
  }
  return true;
}

/** Detect a Chromium-based browser path cross-platform. */
function findBrowser() {
  const platform = os.platform();

  const candidates = [];
  if (platform === 'win32') {
    candidates.push(
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    );
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    );
  } else {
    // Linux
    candidates.push(
      ...['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium', 'microsoft-edge'].map(name => {
        try { return execSync(`which ${name}`, { encoding: 'utf8' }).trim(); }
        catch { return ''; }
      }).filter(Boolean),
    );
  }

  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function preflight() {
  let ok = true;
  if (!checkNode()) ok = false;
  if (!checkApiKey()) ok = false;
  if (!checkSkillFiles()) ok = false;

  const browser = findBrowser();
  if (!browser) {
    err('No Chromium-based browser found (Edge, Chrome, or Chromium).');
    if (os.platform() === 'win32') err('Install Edge from https://www.microsoft.com/edge');
    else if (os.platform() === 'darwin') err('Install Chrome from https://www.google.com/chrome');
    else err('Install chromium or google-chrome via your package manager.');
    ok = false;
  }

  return ok ? browser : null;
}

// ─── Server ───────────────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.map':  'application/json',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
};

const ALLOWED_OUTPUTS = new Set(['result.json', 'error.txt']);

function createServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // CORS headers for same-origin ESM loads
      res.setHeader('Access-Control-Allow-Origin', '*');

      if (req.method === 'POST' && req.url.startsWith('/save')) {
        const url = new URL(req.url, 'http://localhost');
        const name = url.searchParams.get('name') || '';
        if (!ALLOWED_OUTPUTS.has(name)) {
          res.writeHead(400); return res.end('bad name');
        }
        const out = path.join(ROOT, name);
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
          fs.writeFile(out, Buffer.concat(chunks), e => {
            if (e) { res.writeHead(500); return res.end(String(e)); }
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('ok');
          });
        });
        return;
      }

      let rel = decodeURIComponent(req.url.split('?')[0].split('#')[0]).replace(/^\/+/, '');
      if (!rel) rel = 'assets/vitallens-scan.html';
      const file = path.normalize(path.join(ROOT, rel));
      if (!file.startsWith(ROOT)) {
        res.writeHead(403); return res.end('forbidden');
      }
      fs.readFile(file, (e, data) => {
        if (e) { res.writeHead(404); return res.end('not found: ' + rel); }
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        res.end(data);
      });
    });

    server.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

// ─── Browser launch ───────────────────────────────────────────────────────────

function launchBrowser(browserPath, url) {
  // Use a unique user-data-dir per run so that all command-line flags take
  // effect even if a previous browser process is still lingering. Chromium
  // ignores flags on subsequent spawns that reuse an existing profile.
  const profileDir = path.join(os.tmpdir(), `vitallens-profile-${Date.now()}`);
  fs.mkdirSync(profileDir, { recursive: true });

  const args = [
    `--app=${url}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    // Auto-grant camera permission — no manual "Allow" click needed
    '--use-fake-ui-for-media-stream',
    // Force DPR=1 to prevent MediaRecorder from scaling encoded frames
    '--force-device-scale-factor=1',
    '--high-dpi-support=1',
    // Force software VP8 — Edge's hardware encoder produces non-standard
    // output that ffmpeg.wasm inside vitallens.browser.js cannot decode.
    '--disable-accelerated-video-encode',
  ];

  const proc = spawn(browserPath, args, {
    detached: true,
    stdio: 'ignore',
  });
  proc.unref();
  proc._profileDir = profileDir;
  return proc;
}

// ─── Poll for result ──────────────────────────────────────────────────────────

function pollForResult() {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (fs.existsSync(RESULT_PATH)) {
        clearInterval(timer);
        resolve('result');
      } else if (fs.existsSync(ERROR_PATH)) {
        clearInterval(timer);
        resolve('error');
      } else if (Date.now() - start > POLL_TIMEOUT_MS) {
        clearInterval(timer);
        reject(new Error('timeout'));
      }
    }, POLL_INTERVAL_MS);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const MAX_LAUNCHER_RETRIES = 3;

async function main() {
  log('vitallens-rppg launcher (cross-platform)');
  log('─'.repeat(40));

  // Preflight
  const browserPath = preflight();
  if (!browserPath) process.exit(1);
  log(`✓ Browser: ${path.basename(browserPath)}`);
  log('✓ All checks passed');

  // Start server (shared across retries)
  const server = await createServer();
  const port = server.address().port;
  log(`✓ Server listening on http://127.0.0.1:${port}`);

  const apiKey = encodeURIComponent(process.env.VITALLENS_API_KEY);
  const url = `http://127.0.0.1:${port}/assets/vitallens-scan.html#key=${apiKey}`;

  let lastErrMsg = '';

  for (let attempt = 1; attempt <= MAX_LAUNCHER_RETRIES; attempt++) {
    // Clean stale outputs
    try { fs.unlinkSync(RESULT_PATH); } catch {}
    try { fs.unlinkSync(ERROR_PATH); } catch {}

    if (attempt > 1) {
      log(`\n⟳ Retry ${attempt}/${MAX_LAUNCHER_RETRIES} — restarting browser…`);
    }

    // Launch browser
    const browserProc = launchBrowser(browserPath, url);
    if (attempt === 1) {
      log('✓ Browser opened — measurement will start automatically');
      log('  (camera ~12s + API analysis ~10–30s)');
    }

    // Wait for result
    let outcome;
    try {
      outcome = await pollForResult();
    } catch {
      outcome = 'timeout';
    }

    // Kill browser process tree for this attempt
    try {
      if (os.platform() === 'win32') {
        execSync(`taskkill /F /PID ${browserProc.pid} /T`, { stdio: 'ignore' });
      } else {
        process.kill(-browserProc.pid, 'SIGKILL');
      }
    } catch {}

    // Clean up temp browser profile (can be 50+ MB each)
    try { fs.rmSync(browserProc._profileDir, { recursive: true, force: true }); } catch {}

    if (outcome === 'result') {
      // Success
      server.close();
      const json = JSON.parse(fs.readFileSync(RESULT_PATH, 'utf8'));
      const hr = json.vitals?.heart_rate;
      const rr = json.vitals?.respiratory_rate;

      log('\n══════ MEASUREMENT RESULT ══════');
      if (hr) log(`  Heart rate         ${hr.value.toFixed(1)} bpm   (confidence ${hr.confidence.toFixed(2)})`);
      if (rr) log(`  Respiratory rate   ${rr.value.toFixed(1)} rpm   (confidence ${rr.confidence.toFixed(2)})`);
      log('════════════════════════════════');
      log(`Full result: ${RESULT_PATH}`);
      log('⚠ Research use only. Not a medical device.');
      return;
    }

    if (outcome === 'error') {
      lastErrMsg = fs.readFileSync(ERROR_PATH, 'utf8');
      const isRetryable = /mismatch|buffer length/i.test(lastErrMsg);
      if (isRetryable && attempt < MAX_LAUNCHER_RETRIES) {
        log(`⚠ Encoding error (attempt ${attempt}/${MAX_LAUNCHER_RETRIES}), will retry…`);
        continue;
      }
    }

    if (outcome === 'timeout') {
      lastErrMsg = 'Timed out — no result within ' + (POLL_TIMEOUT_MS / 1000) + 's.';
    }

    // Non-retryable error or last attempt
    break;
  }

  // All attempts failed
  server.close();
  err('Measurement failed:');
  err(lastErrMsg);
  process.exit(2);
}

main().catch(e => {
  err(e.message || String(e));
  process.exit(1);
});
