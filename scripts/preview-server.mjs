import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
};

export function parseByteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(header ?? '').trim());
  if (!match || !Number.isSafeInteger(size) || size <= 0) return null;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

export function createPreviewServer({ root = projectRoot } = {}) {
  const absoluteRoot = resolve(root);
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const filePath = resolve(absoluteRoot, relative);
      if (filePath !== absoluteRoot && !filePath.startsWith(`${absoluteRoot}${sep}`)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error('Not a file');
      const type = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
      const range = request.headers.range ? parseByteRange(request.headers.range, info.size) : null;
      if (request.headers.range && !range) {
        response.writeHead(416, { 'Content-Range': `bytes */${info.size}` }).end();
        return;
      }
      const headers = {
        'Accept-Ranges': 'bytes',
        'Content-Type': type,
        'Cache-Control': 'no-cache',
      };
      if (range) {
        headers['Content-Length'] = range.end - range.start + 1;
        headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`;
        response.writeHead(206, headers);
        if (request.method === 'HEAD') response.end();
        else createReadStream(filePath, range).pipe(response);
        return;
      }
      headers['Content-Length'] = info.size;
      response.writeHead(200, headers);
      if (request.method === 'HEAD') response.end();
      else createReadStream(filePath).pipe(response);
    } catch (error) {
      process.stderr.write(`Preview request failed: ${error?.message ?? error}\n`);
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
  });
}

const isEntry = process.argv[1]
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isEntry) {
  const port = Number(process.env.PORT) || 8080;
  createPreviewServer().listen(port, '127.0.0.1', () => {
    process.stdout.write(`Preview running at http://localhost:${port}/\n`);
  });
}
