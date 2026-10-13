import { getStore } from '@netlify/blobs';
import { randomToken } from './crypto';
import { badRequest } from './http';

export const store = () => getStore({ name: 'uploads', consistency: 'strong' });

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
