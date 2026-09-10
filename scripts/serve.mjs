import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import accessHandler from '../api/access.js';
import accountHandler from '../api/account.js';

const port = Number(process.env.PORT || 4173);
const root = process.cwd();
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer((request, response) => {
  if (request.url.split('?')[0] === '/api/access') return accessHandler(request, response);
  if (request.url.split('?')[0] === '/api/account') return accountHandler(request, response);
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Invalid URL');
    return;
  }
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const cleanCandidate = extname(requested) ? requested : `${requested}.html`;
  const relativePath = existsSync(join(root, cleanCandidate)) ? cleanCandidate : requested;
  const filePath = normalize(join(root, relativePath));

  const hasUnsafeSegment = relativePath.split(/[\\/]/).some(segment => segment.startsWith('.'));
  const allowed = !hasUnsafeSegment && /^(index\.html|privacy(?:\.html)?|terms(?:\.html)?|(?:js|styles|assets)\/[\w./-]+)$/.test(relativePath);
  if (!allowed || !filePath.startsWith(root + sep) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found');
    return;
  }

  response.writeHead(200, {
    'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  createReadStream(filePath).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`Club Link is running at http://127.0.0.1:${port}`);
});
