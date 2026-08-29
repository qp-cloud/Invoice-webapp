import type { ErrorCode } from '@inventory/shared';

export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  correlationId: string;
}

export class ApiRequestError extends Error {
  readonly status: number;
  readonly api: ApiError;
  constructor(status: number, api: ApiError) {
    super(api.message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.api = api;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`/api${path}`, {
    method,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json()) as unknown;
  if (!res.ok) {
    const err = (json as { error?: ApiError }).error;
    throw new ApiRequestError(res.status, err ?? {
      code: 'INTERNAL',
      message: 'unknown error',
      correlationId: '',
    });
  }
  return json as T;
}

async function requestForm<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`/api${path}`, { method: 'POST', body: form });
  const json = (await res.json()) as unknown;
  if (!res.ok) {
    const err = (json as { error?: ApiError }).error;
    throw new ApiRequestError(
      res.status,
      err ?? { code: 'INTERNAL', message: 'unknown error', correlationId: '' },
    );
  }
  return json as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: (path: string) => request<void>('DELETE', path),
  /** POST a transaction with a fresh Idempotency-Key (spec §14.1). */
  postTxn: <T>(path: string, body: unknown) =>
    request<T>('POST', path, body, { 'idempotency-key': crypto.randomUUID() }),
  /** POST an import commit with a fresh Idempotency-Key. */
  commitImport: <T>(path: string, body: unknown) =>
    request<T>('POST', path, body, { 'idempotency-key': crypto.randomUUID() }),
  postForm: requestForm,
};

/** Absolute URL for a streamed .xlsx download (opened in a new tab). */
export const exportUrl = (kind: string, query = ''): string =>
  `/api/exports/${kind}.xlsx${query}`;
