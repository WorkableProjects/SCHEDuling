import type { ZodType } from 'zod';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}
export const badRequest = (m: string) => new HttpError(400, m, 'bad_request');
export const unauthorized = (m = 'Sign in required') => new HttpError(401, m, 'unauthorized');
export const forbidden = (m = 'You do not have permission to do that') => new HttpError(403, m, 'forbidden');
export const notFound = (m = 'Not found') => new HttpError(404, m, 'not_found');
export const conflict = (m: string, extra?: Record<string, unknown>) => new HttpError(409, m, 'conflict', extra);

export function json(data: unknown, init: ResponseInit & { cookies?: string[] } = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  for (const c of init.cookies ?? []) headers.append('set-cookie', c);
  return new Response(JSON.stringify(data), { status: init.status ?? 200, headers });
}

export function text(body: string, contentType: string, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', contentType);
  headers.set('cache-control', 'no-store');
  return new Response(body, { ...init, headers });
}

export function csv(filename: string, rows: (string | number | boolean | null | undefined)[][]) {
  // Prefix cells starting with = + - @ to neutralise spreadsheet formula injection.
  const esc = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
  return text(body, 'text/csv; charset=utf-8', {
    headers: { 'content-disposition': `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"` },
  });
}

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(req: Request, name: string, value: string, maxAgeSeconds: number) {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clientIp(req: Request) {
  return (
    req.headers.get('x-nf-client-connection-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

export async function readJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw badRequest('Request body must be valid JSON');
  }
  return parse(schema, raw);
}

export function parse<T>(schema: ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (!r.success) throw zodToHttp(r.error);
  return r.data;
}

function zodToHttp(e: ZodError) {
  const issue = e.issues[0];
  const path = issue?.path.join('.') ?? '';
  return new HttpError(400, `${path ? path + ': ' : ''}${issue?.message ?? 'Invalid input'}`, 'validation', {
    issues: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
  });
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) {
    return json({ error: e.message, code: e.code, ...e.extra }, { status: e.status });
  }
  console.error('Unhandled error', e);
  return json({ error: 'Something went wrong on our side. Please try again.', code: 'internal' }, { status: 500 });
}

export const isUuid = (s: unknown): boolean =>
  typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
