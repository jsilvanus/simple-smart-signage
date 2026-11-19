import crypto from 'node:crypto';
import http from 'node:http';

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sendXmlError(res, status, code, message) {
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Error><Code>${escapeXml(code)}</Code><Message>${escapeXml(message)}</Message></Error>`;
  const buf = Buffer.from(xml, 'utf8');
  res.writeHead(status, { 'content-type': 'application/xml', 'content-length': buf.length });
  res.end(buf);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks);
  const sha = String(req.headers['x-amz-content-sha256'] ?? '');
  const enc = String(req.headers['content-encoding'] ?? '');
  if (!sha.startsWith('STREAMING-') && !enc.includes('aws-chunked')) {
    return raw;
  }
  const out = [];
  let pos = 0;
  while (pos < raw.length) {
    const crlf = raw.indexOf('\r\n', pos);
    if (crlf === -1) break;
    const headerLine = raw.subarray(pos, crlf).toString('ascii');
    const semi = headerLine.indexOf(';');
    const sizeHex = semi === -1 ? headerLine : headerLine.slice(0, semi);
    const size = Number.parseInt(sizeHex, 16);
    if (!Number.isFinite(size) || size === 0) break;
    const dataStart = crlf + 2;
    out.push(raw.subarray(dataStart, dataStart + size));
    pos = dataStart + size + 2; // skip trailing \r\n
  }
  return Buffer.concat(out);
}

/**
 * In-process path-style fake S3 HTTP server for testing @aws-sdk/client-s3.
 * Supports PUT (with If-Match / If-None-Match), GET (with Range), HEAD, DELETE, ListObjectsV2.
 */
export async function startFakeS3({ maxKeys = 1000 } = {}) {
  const buckets = new Map(); // bucket -> Map(key -> { body, contentType, etag, lastModified })

  function getBucket(name) {
    let b = buckets.get(name);
    if (!b) {
      b = new Map();
      buckets.set(name, b);
    }
    return b;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const parts = url.pathname.slice(1).split('/');
      const bucketName = decodeURIComponent(parts[0] || '');
      if (!bucketName) {
        sendXmlError(res, 400, 'InvalidBucketName', 'Missing bucket');
        return;
      }
      const store = getBucket(bucketName);
      const rawKey = parts.slice(1).join('/');
      const key = rawKey ? decodeURIComponent(rawKey) : '';

      if (req.method === 'GET' && !key && url.searchParams.get('list-type') === '2') {
        const prefix = url.searchParams.get('prefix') ?? '';
        const token = url.searchParams.get('continuation-token');
        const reqMax = Number(url.searchParams.get('max-keys')) || maxKeys;
        const limit = Math.min(reqMax, maxKeys);

        const matching = [];
        for (const [k, obj] of store.entries()) {
          if (k.startsWith(prefix)) matching.push([k, obj]);
        }
        matching.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

        const offset = token ? Number(token) : 0;
        const page = matching.slice(offset, offset + limit);
        const isTruncated = offset + page.length < matching.length;
        const nextToken = isTruncated ? String(offset + page.length) : '';

        const contentsXml = page
          .map(
            ([k, obj]) =>
              `<Contents>` +
              `<Key>${escapeXml(k)}</Key>` +
              `<LastModified>${obj.lastModified.toISOString()}</LastModified>` +
              `<ETag>${escapeXml(obj.etag)}</ETag>` +
              `<Size>${obj.body.length}</Size>` +
              `</Contents>`,
          )
          .join('');

        const xml =
          `<?xml version="1.0" encoding="UTF-8"?>` +
          `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
          `<Name>${escapeXml(bucketName)}</Name>` +
          `<Prefix>${escapeXml(prefix)}</Prefix>` +
          `<KeyCount>${page.length}</KeyCount>` +
          `<MaxKeys>${limit}</MaxKeys>` +
          `<IsTruncated>${isTruncated}</IsTruncated>` +
          (nextToken ? `<NextContinuationToken>${escapeXml(nextToken)}</NextContinuationToken>` : '') +
          contentsXml +
          `</ListBucketResult>`;
        const buf = Buffer.from(xml, 'utf8');
        res.writeHead(200, { 'content-type': 'application/xml', 'content-length': buf.length });
        res.end(buf);
        return;
      }

      if (!key) {
        sendXmlError(res, 400, 'InvalidRequest', 'Missing key');
        return;
      }

      if (req.method === 'PUT') {
        const body = await readBody(req);
        const existing = store.get(key);
        const ifNoneMatch = req.headers['if-none-match'];
        const ifMatch = req.headers['if-match'];

        if (ifNoneMatch === '*' && existing) {
          sendXmlError(res, 412, 'PreconditionFailed', 'Object already exists');
          return;
        }
        if (ifMatch !== undefined && (!existing || existing.etag !== ifMatch)) {
          sendXmlError(res, 412, 'PreconditionFailed', 'ETag mismatch');
          return;
        }

        const etag = `"${crypto.createHash('md5').update(body).digest('hex')}"`;
        const contentType = req.headers['content-type'] || 'application/octet-stream';
        store.set(key, { body, contentType, etag, lastModified: new Date() });
        res.writeHead(200, { etag, 'content-length': 0 });
        res.end();
        return;
      }

      if (req.method === 'HEAD') {
        const obj = store.get(key);
        if (!obj) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, {
          'content-length': obj.body.length,
          'content-type': obj.contentType,
          etag: obj.etag,
          'last-modified': obj.lastModified.toUTCString(),
        });
        res.end();
        return;
      }

      if (req.method === 'GET') {
        const obj = store.get(key);
        if (!obj) {
          sendXmlError(res, 404, 'NoSuchKey', 'The specified key does not exist.');
          return;
        }
        const total = obj.body.length;
        const rangeHeader = req.headers['range'];
        if (rangeHeader) {
          const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
          if (!m) {
            sendXmlError(res, 416, 'InvalidRange', 'Invalid range');
            return;
          }
          const start = Number(m[1]);
          const end = m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1);
          if (total === 0 || start >= total || end < start) {
            sendXmlError(res, 416, 'InvalidRange', 'Range not satisfiable');
            return;
          }
          const slice = obj.body.subarray(start, end + 1);
          res.writeHead(206, {
            'content-type': obj.contentType,
            'content-length': slice.length,
            'content-range': `bytes ${start}-${end}/${total}`,
            etag: obj.etag,
            'last-modified': obj.lastModified.toUTCString(),
          });
          res.end(slice);
          return;
        }
        res.writeHead(200, {
          'content-type': obj.contentType,
          'content-length': total,
          etag: obj.etag,
          'last-modified': obj.lastModified.toUTCString(),
        });
        res.end(obj.body);
        return;
      }

      if (req.method === 'DELETE') {
        store.delete(key);
        res.writeHead(204);
        res.end();
        return;
      }

      sendXmlError(res, 405, 'MethodNotAllowed', `Unsupported method ${req.method}`);
    } catch (err) {
      sendXmlError(res, 500, 'InternalError', err.message);
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
