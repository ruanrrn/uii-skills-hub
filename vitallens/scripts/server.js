#!/usr/bin/env node
// Tiny static file server for the vitallens-scan.html page.
//
// Why this exists: Chromium treats every `file://` URL as a unique null origin,
// so the ESM module load chain (vitallens-shim.js → vitallens.browser.js) is
// blocked by CORS. Serving over `http://localhost` gives the page a real origin
// where ESM imports work normally.
//
// Usage:
//   node server.js <root_dir>   # picks a free port, prints "PORT=12345"
// Env:
//   PORT=8080                   # force a specific port (default: 0 = OS-assigned)
//
// Zero external deps — only Node stdlib. Tested on Node 18+.

const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const requestedPort = parseInt(process.env.PORT || '0', 10);

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

// The page POSTs the measurement output back here. Only two filenames are
// allowed, written to the project root:
//   result.json — successful run, raw API response + capture_meta
//   error.txt   — failure, the JS stack/message from the page
const ALLOWED_OUTPUTS = new Set(['result.json', 'error.txt']);

function handleSave(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const name = url.searchParams.get('name') || '';
  if (!ALLOWED_OUTPUTS.has(name)) {
    res.writeHead(400); return res.end('bad name');
  }
  const out = path.join(root, name);
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    fs.writeFile(out, Buffer.concat(chunks), err => {
      if (err) { res.writeHead(500); return res.end(String(err)); }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    });
  });
  req.on('error', err => { res.writeHead(500); res.end(String(err)); });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/save')) {
    return handleSave(req, res);
  }
  let rel = decodeURIComponent(req.url.split('?')[0].split('#')[0]).replace(/^\/+/, '');
  if (!rel) rel = 'assets/vitallens-scan.html';
  const file = path.normalize(path.join(root, rel));
  // Guard against path traversal — must stay inside root
  if (!file.startsWith(root)) {
    res.writeHead(403); return res.end('forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('not found: ' + rel);
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

server.listen(requestedPort, '127.0.0.1', () => {
  const addr = server.address();
  process.stdout.write('PORT=' + addr.port + '\n');
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
