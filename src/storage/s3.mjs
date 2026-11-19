import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  StorageConflictError,
  inferContentType,
  mediaKey,
  validateJsonKey,
  validateMediaParts,
  validatePrefix,
} from './common.mjs';

function isNotFound(err) {
  const code = err?.$metadata?.httpStatusCode;
  return code === 404 || err?.name === 'NoSuchKey' || err?.name === 'NotFound';
}

function isConflict(err) {
  const code = err?.$metadata?.httpStatusCode;
  return code === 412 || code === 409 || err?.name === 'PreconditionFailed';
}

function parseContentRange(header) {
  const m = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(String(header ?? ''));
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]), size: Number(m[3]) };
}

/** S3-compatible Storage driver backed by @aws-sdk/client-s3. */
export function createS3Storage(s3Config, _opts = {}) {
  if (!s3Config?.bucket) throw new Error('s3.bucket is required for S3 storage');

  const clientOpts = {
    region: s3Config.region || 'us-east-1',
    forcePathStyle: s3Config.forcePathStyle ?? true,
    credentials: {
      accessKeyId: s3Config.accessKeyId,
      secretAccessKey: s3Config.secretAccessKey,
    },
  };
  if (s3Config.endpoint) {
    clientOpts.endpoint = s3Config.endpoint;
  }

  const client = new S3Client(clientOpts);
  const Bucket = s3Config.bucket;
  const cleanPrefix = s3Config.prefix ? String(s3Config.prefix).replace(/^\/+|\/+$/g, '') : '';
  const basePrefix = cleanPrefix ? `${cleanPrefix}/` : '';

  const toS3Key = (key) => basePrefix + key;
  const fromS3Key = (s3Key) =>
    basePrefix && s3Key.startsWith(basePrefix) ? s3Key.slice(basePrefix.length) : s3Key;

  return {
    async putMediaFromFile(sha256, ext, filePath, contentType) {
      const key = mediaKey(sha256, ext);
      const Key = toS3Key(key);
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket, Key }));
        return { key, size: head.ContentLength ?? 0 };
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
      const st = await fs.stat(filePath);
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key,
          Body: createReadStream(filePath),
          ContentLength: st.size,
          ContentType: contentType || 'application/octet-stream',
        }),
      );
      return { key, size: st.size };
    },

    async getMedia(sha256, ext, { start, end } = {}) {
      const key = mediaKey(sha256, ext);
      const Key = toS3Key(key);
      const hasRange = start !== undefined || end !== undefined;
      if (hasRange) {
        const s = start ?? 0;
        if (!Number.isInteger(s) || s < 0 || (end !== undefined && (!Number.isInteger(end) || end < s))) {
          throw new RangeError(`Invalid range [${start}, ${end}]`);
        }
      }
      const Range = hasRange ? `bytes=${start ?? 0}-${end ?? ''}` : undefined;
      let res;
      try {
        res = await client.send(new GetObjectCommand({ Bucket, Key, ...(Range ? { Range } : {}) }));
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
      const parsed = hasRange ? parseContentRange(res.ContentRange) : null;
      const size = parsed ? parsed.size : (res.ContentLength ?? 0);
      const actualStart = parsed ? parsed.start : 0;
      const actualEnd = parsed ? parsed.end : size > 0 ? size - 1 : -1;
      return {
        stream: res.Body,
        size,
        contentType: res.ContentType || inferContentType(ext),
        start: actualStart,
        end: actualEnd,
      };
    },

    async statMedia(sha256, ext) {
      const Key = toS3Key(mediaKey(sha256, ext));
      let res;
      try {
        res = await client.send(new HeadObjectCommand({ Bucket, Key }));
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
      return {
        size: res.ContentLength ?? 0,
        contentType: res.ContentType || inferContentType(ext),
        lastModified: res.LastModified ?? new Date(),
      };
    },

    async deleteMedia(sha256, ext) {
      const Key = toS3Key(mediaKey(sha256, ext));
      try {
        await client.send(new DeleteObjectCommand({ Bucket, Key }));
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    },

    async *listMedia() {
      let ContinuationToken;
      do {
        const res = await client.send(
          new ListObjectsV2Command({
            Bucket,
            Prefix: toS3Key('media/'),
            ContinuationToken,
          }),
        );
        for (const obj of res.Contents ?? []) {
          const rel = fromS3Key(obj.Key);
          if (!rel.startsWith('media/')) continue;
          const name = rel.slice('media/'.length);
          const dot = name.lastIndexOf('.');
          if (dot <= 0 || dot === name.length - 1) continue;
          const sha256 = name.slice(0, dot);
          const ext = name.slice(dot + 1);
          try {
            validateMediaParts(sha256, ext);
          } catch {
            continue;
          }
          yield {
            sha256,
            ext,
            size: obj.Size ?? 0,
            lastModified: obj.LastModified ?? new Date(),
          };
        }
        ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (ContinuationToken);
    },

    async getJson(key) {
      validateJsonKey(key);
      let res;
      try {
        res = await client.send(new GetObjectCommand({ Bucket, Key: toS3Key(key) }));
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
      const text = await res.Body.transformToString('utf8');
      return { value: JSON.parse(text), etag: res.ETag };
    },

    async putJson(key, value, { ifMatch } = {}) {
      validateJsonKey(key);
      const body = Buffer.from(JSON.stringify(value), 'utf8');
      const params = {
        Bucket,
        Key: toS3Key(key),
        Body: body,
        ContentLength: body.length,
        ContentType: 'application/json; charset=utf-8',
      };
      if (ifMatch === null) {
        params.IfNoneMatch = '*';
      } else if (ifMatch !== undefined) {
        params.IfMatch = ifMatch;
      }
      try {
        const res = await client.send(new PutObjectCommand(params));
        return { etag: res.ETag };
      } catch (err) {
        if (isConflict(err) || (ifMatch !== undefined && ifMatch !== null && isNotFound(err))) {
          throw new StorageConflictError(`Conflict writing key: ${key}`);
        }
        throw err;
      }
    },

    async deleteJson(key) {
      validateJsonKey(key);
      try {
        await client.send(new DeleteObjectCommand({ Bucket, Key: toS3Key(key) }));
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    },

    async listJson(prefix = '') {
      validatePrefix(prefix);
      const keys = [];
      let ContinuationToken;
      do {
        const res = await client.send(
          new ListObjectsV2Command({
            Bucket,
            Prefix: toS3Key(prefix),
            ContinuationToken,
          }),
        );
        for (const obj of res.Contents ?? []) {
          const rel = fromS3Key(obj.Key);
          if (rel.startsWith('media/')) continue;
          if (rel.startsWith(prefix)) keys.push(rel);
        }
        ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (ContinuationToken);
      keys.sort();
      return keys;
    },
  };
}
