import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { inferContentType } from '../storage/common.mjs';

export const STANDARD_WIDTHS = Object.freeze([480, 720, 1080, 1440]);

async function writeTmp(buf, ext) {
  const tmpPath = path.join(os.tmpdir(), `sissi-var-${crypto.randomBytes(8).toString('hex')}.${ext}`);
  await fs.writeFile(tmpPath, buf);
  return tmpPath;
}

/**
 * Generate standard downscaled WebP variants for an image.
 * Returns { width, height, variants: [{ width, height, ext: 'webp', mediaId }] }.
 */
export async function generateVariants(input, sha256, storage) {
  try {
    const meta = await sharp(input).metadata();
    const origWidth = meta.width;
    const origHeight = meta.height;
    if (!origWidth || !origHeight) {
      return { width: null, height: null, variants: [] };
    }

    const variants = [];
    for (const w of STANDARD_WIDTHS) {
      if (w < origWidth) {
        const vBuf = await sharp(input)
          .resize({ width: w, withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
        const vMeta = await sharp(vBuf).metadata();
        const mediaId = `${sha256}-${w}w`;
        const tmpPath = await writeTmp(vBuf, 'webp');
        try {
          await storage.putMediaFromFile(mediaId, 'webp', tmpPath, 'image/webp');
          variants.push({
            width: vMeta.width || w,
            height: vMeta.height,
            ext: 'webp',
            mediaId,
          });
        } finally {
          await fs.rm(tmpPath, { force: true }).catch(() => {});
        }
      }
    }
    return { width: origWidth, height: origHeight, variants };
  } catch (err) {
    return { width: null, height: null, variants: [] };
  }
}

const COMMON_IMAGE_EXTS = Object.freeze(['png', 'jpg', 'jpeg', 'webp', 'gif']);

/**
 * Retrieves an existing variant or generates it on-the-fly from the original image.
 */
export async function getOrGenerateVariant(storage, sha256, variantTag, ext) {
  const mediaId = `${sha256}-${variantTag}`;
  const existing = await storage.getMedia(mediaId, ext);
  if (existing) return existing;

  const width = parseInt(variantTag, 10);
  if (!Number.isFinite(width) || width <= 0 || width > 4000) return null;

  // Find original image in storage
  let orig = null;
  for (const testExt of COMMON_IMAGE_EXTS) {
    const stat = await storage.statMedia(sha256, testExt);
    if (stat) {
      orig = await storage.getMedia(sha256, testExt);
      break;
    }
  }
  if (!orig) return null;

  try {
    const chunks = [];
    for await (const chunk of orig.stream) {
      chunks.push(chunk);
    }
    const origBuf = Buffer.concat(chunks);

    let pipeline = sharp(origBuf).resize({ width, withoutEnlargement: true });
    if (ext === 'webp') {
      pipeline = pipeline.webp({ quality: 82 });
    } else if (ext === 'jpg' || ext === 'jpeg') {
      pipeline = pipeline.jpeg({ quality: 82 });
    } else if (ext === 'png') {
      pipeline = pipeline.png({ compressionLevel: 8 });
    }
    const vBuf = await pipeline.toBuffer();
    const tmpPath = await writeTmp(vBuf, ext);
    const contentType = inferContentType(ext);
    try {
      await storage.putMediaFromFile(mediaId, ext, tmpPath, contentType);
    } finally {
      await fs.rm(tmpPath, { force: true }).catch(() => {});
    }

    return {
      stream: Readable.from(vBuf),
      size: vBuf.length,
      contentType,
      start: 0,
      end: vBuf.length - 1,
    };
  } catch (err) {
    return null;
  }
}
