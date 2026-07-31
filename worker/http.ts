// Единый формат ошибок API (docs/design.md §12) и security-заголовки (§13).

import type { Context } from 'hono';
import type { ApiErrorBody, ApiErrorCode } from '../shared/types';

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 500;

export function jsonError(
  c: Context,
  status: ErrorStatus,
  code: ApiErrorCode,
  message: string,
): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return c.json(body, status);
}

// Заголовки для всех ответов /api/*.
export function setApiResponseHeaders(headers: Headers): void {
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'no-store');
}

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; connect-src 'self'; manifest-src 'self'; " +
  "worker-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

// Security-заголовки на статику: nosniff — всем, CSP и анти-фрейминг — только HTML.
// Ответ клонируется, чтобы заголовки ассетов (Cache-Control, ETag и т.д.) сохранились.
export function withAssetSecurityHeaders(assetResponse: Response): Response {
  const response = new Response(assetResponse.body, assetResponse);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  const contentType = response.headers.get('Content-Type') ?? '';
  if (contentType.toLowerCase().includes('text/html')) {
    response.headers.set('Content-Security-Policy', CSP);
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.headers.set('X-Frame-Options', 'DENY');
  }
  return response;
}
