export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public data?: any) {
    super(message);
  }
}

let csrf: string | null = null;
export const setCsrf = (t: string | null) => { csrf = t; };

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf;
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'Network error. Check your connection and try again.', 'network');
  }
  const isJson = res.headers.get('content-type')?.includes('json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.code, data);
  return data as T;
}
export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b: unknown = {}) => api<T>('POST', p, b);
export const patch = <T = any>(p: string, b: unknown = {}) => api<T>('PATCH', p, b);
export const put = <T = any>(p: string, b: unknown) => api<T>('PUT', p, b);
export const del = <T = any>(p: string) => api<T>('DELETE', p);
