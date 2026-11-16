'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const webRoot = path.resolve(__dirname, '..', 'web');
const host = '127.0.0.1';
const port = Math.max(1024, Math.min(65535, Number(process.env.PORT) || 4173));
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8'
};
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'none'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "script-src 'self' 'unsafe-inline' blob:",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "worker-src 'self' blob:",
  "navigate-to 'self'"
].join('; ');

const server = http.createServer((req, res) => {
  const headers = {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Cross-Origin-Opener-Policy': 'same-origin'
  };
  const reply = (status, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(status, { ...headers, 'Content-Type': type });
    res.end(req.method === 'HEAD' ? undefined : body);
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    reply(405, 'Offline Sandbox serves static files only.');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    reply(400, 'Bad request');
    return;
  }
  if (pathname === '/' || pathname.endsWith('/')) pathname += 'index.html';

  // This server deliberately exposes only the sandbox entry page, not registration,
  // password-reset, LINE callback, or any other live-flow HTML pages.
  if (path.extname(pathname).toLowerCase() === '.html' &&
      !['/index.html'].includes(pathname)) {
    reply(404, 'This page is not available in Offline Sandbox.');
    return;
  }

  const filePath = path.resolve(webRoot, '.' + pathname);
  if (filePath !== webRoot && !filePath.startsWith(webRoot + path.sep)) {
    reply(403, 'Forbidden');
    return;
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      reply(404, 'Not found');
      return;
    }
    const type = mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { ...headers, 'Content-Type': type, 'Content-Length': stat.size });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(filePath).on('error', () => {
      if (!res.headersSent) reply(500, 'Unable to read file');
      else res.destroy();
    }).pipe(res);
  });
});

server.listen(port, host, () => {
  process.stdout.write('Finance MEDTECH Offline Sandbox: http://' + host + ':' + port + '/\n');
  process.stdout.write('Network APIs are blocked. Stop with Ctrl+C.\n');
});
