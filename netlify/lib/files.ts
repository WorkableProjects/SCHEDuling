import { getStore } from '@netlify/blobs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomToken } from './crypto';
import { badRequest } from './http';

type BlobStore = {
  set(key: string, data: ArrayBuffer | Uint8Array, opts?: { metadata?: Record<string, unknown> }): Promise<unknown>;
  get(key: string, opts: { type: 'arrayBuffer' }): Promise<ArrayBuffer | null>;
  getWithMetadata(key: string, opts: { type: 'arrayBuffer' }): Promise<{ data: ArrayBuffer; metadata: Record<string, unknown> } | null>;
  delete(key: string): Promise<unknown>;
};

/** Local-dev stand-in (only when LOCAL_BLOBS_DIR is set): same API, files on disk. Production always uses Netlify Blobs. */
function localStore(dir: string): BlobStore {
  const file = (k: string) => join(dir, encodeURIComponent(k));
  return {
    async set(k, data, o) { await mkdir(dir, { recursive: true }); await writeFile(file(k), new Uint8Array(data as ArrayBuffer)); await writeFile(file(k) + '.meta', JSON.stringify(o?.metadata ?? {})); },
    async get(k) { try { const b = await readFile(file(k)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; } catch { return null; } },
    async getWithMetadata(k) {
      const data = await this.get(k, { type: 'arrayBuffer' });
      if (!data) return null;
      return { data, metadata: JSON.parse(await readFile(file(k) + '.meta', 'utf8').catch(() => '{}')) };
    },
    async delete(k) { await rm(file(k), { force: true }); await rm(file(k) + '.meta', { force: true }); },
  };
}

export const store = (): BlobStore =>
  process.env.LOCAL_BLOBS_DIR ? localStore(process.env.LOCAL_BLOBS_DIR) : (getStore({ name: 'uploads', consistency: 'strong' }) as unknown as BlobStore);

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
// Netlify synchronous functions accept ~6 MB request bodies, so stay under that.
export const MAX_MATERIAL_BYTES = 5 * 1024 * 1024;

const IMAGE_SIGNATURES: { type: string; test: (b: Uint8Array) => boolean }[] = [
  { type: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/webp', test: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 },
];

/** Verifies the bytes really are a PNG/JPEG/WebP (the declared type is never trusted). */
export function sniffImage(bytes: Uint8Array): string {
  const hit = IMAGE_SIGNATURES.find((s) => s.test(bytes));
  if (!hit) throw badRequest('Photos must be PNG, JPEG or WebP images');
  return hit.type;
}

const MATERIAL_TYPES: Record<string, string> = {
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/plain', csv: 'text/csv',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
};
export function materialType(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const type = MATERIAL_TYPES[ext];
  if (!type) throw badRequest(`Unsupported file type. Allowed: ${Object.keys(MATERIAL_TYPES).join(', ')}`);
  return type;
}

export const newKey = (prefix: string) => `${prefix}/${randomToken(16)}`;
export const safeFileName = (n: string) => n.replace(/[^\w.\- ()]/g, '_').slice(0, 120) || 'file';
