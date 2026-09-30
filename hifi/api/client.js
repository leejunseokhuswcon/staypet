/* ============================================================
   StayPet API client — transport only.
   Knows headers, JSON/multipart bodies and the contract's error envelope
   (docs/API_CONTRACT.md §1). It knows nothing about pets, jobs or providers.
   ============================================================ */

export class ApiError extends Error {
  constructor({ status, code, message, retriable = false, requestId = null, details = {} }) {
    super(message || code);
    this.name = 'ApiError';
    this.status = status;          // 0 = the request never reached the server
    this.code = code;
    this.retriable = retriable;
    this.requestId = requestId;
    this.details = details;
  }
  get isNetwork() { return this.status === 0; }
}

export function createApiClient({ baseUrl, token = '', ownerId, fetchImpl }) {
  const doFetch = fetchImpl || globalThis.fetch.bind(globalThis);
  const root = String(baseUrl || '').replace(/\/+$/, '');

  async function request(method, path, { json, form, idempotencyKey, signal } = {}) {
    const headers = { 'X-StayPet-Owner-Id': ownerId };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    let body;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form) {
      body = form;                 // the browser sets the multipart boundary
    }

    let res;
    try {
      res = await doFetch(root + path, { method, headers, body, signal });
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      throw new ApiError({ status: 0, code: 'network_unavailable', message: 'Network request failed', retriable: true });
    }

    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = null; }
    }
    if (!res.ok) {
      const e = (data && data.error) || {};
      throw new ApiError({
        status: res.status,
        code: e.code || `http_${res.status}`,
        message: e.message || res.statusText,
        retriable: typeof e.retriable === 'boolean' ? e.retriable : res.status >= 500,
        requestId: e.request_id || (res.headers && res.headers.get && res.headers.get('X-Request-Id')) || null,
        details: e.details || {},
      });
    }
    return data;
  }

  return { request };
}
