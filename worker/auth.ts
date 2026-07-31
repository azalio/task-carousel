// Авторизация через Cloudflare Access (docs/design.md §3, §13).
//
// Порядок: DEV_AUTH_EMAIL (только локальная разработка, .dev.vars) → иначе
// проверка JWT из Cf-Access-Jwt-Assertion (fallback — cookie CF_Authorization)
// через JWKS команды Zero Trust. Email берётся ТОЛЬКО из проверенного JWT.
// Содержимое JWT не логируется.

import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { upsertUserStmt } from './db';
import type { AppEnv } from './env';
import { jsonError } from './http';

// Кэш JWKS в module-scope: инстанс переживает запросы в рамках изолята,
// ключ — team domain (на случай смены значения между деплоями).
const jwksByDomain = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(teamDomain: string): ReturnType<typeof createRemoteJWKSet> {
  const cached = jwksByDomain.get(teamDomain);
  if (cached) return cached;
  const jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
  jwksByDomain.set(teamDomain, jwks);
  return jwks;
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export const accessAuth = createMiddleware<AppEnv>(async (c, next) => {
  let email: string;

  const devEmail = c.env.DEV_AUTH_EMAIL;
  if (devEmail !== undefined && devEmail.trim() !== '') {
    // Только локальная разработка: JWT не проверяем.
    email = normalizeEmail(devEmail);
  } else {
    const token =
      c.req.header('Cf-Access-Jwt-Assertion') ?? getCookie(c, 'CF_Authorization');
    if (!token) {
      return jsonError(c, 401, 'UNAUTHORIZED', 'Требуется авторизация');
    }

    let claimEmail: unknown;
    try {
      const teamDomain = c.env.ACCESS_TEAM_DOMAIN;
      const { payload } = await jwtVerify(token, getJwks(teamDomain), {
        issuer: `https://${teamDomain}`,
        audience: c.env.ACCESS_AUD,
        // exp/nbf jose проверяет сам.
      });
      claimEmail = payload.email;
    } catch {
      // Причину и содержимое токена не раскрываем и не логируем (§13).
      return jsonError(c, 403, 'INVALID_TOKEN', 'Недействительный токен авторизации');
    }

    if (typeof claimEmail !== 'string' || claimEmail.trim() === '') {
      return jsonError(c, 403, 'INVALID_TOKEN', 'В токене авторизации отсутствует email');
    }
    email = normalizeEmail(claimEmail);
  }

  await upsertUserStmt(c.env.DB, email, Date.now()).run();
  c.set('userEmail', email);
  await next();
});
