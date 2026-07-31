import { defineConfig, devices } from '@playwright/test';

// E2E основного сценария ТЗ (docs/design.md §1) в мобильном вьюпорте.
//
// Детерминизм БД: локальная D1 персистится на диск, поэтому e2e используют
// отдельный конфиг vite.config.e2e.ts с persistState в .wrangler/e2e-state.
// Каталог пересоздаётся ПРЯМО в команде webServer (до старта сервера): rm -rf +
// `wrangler d1 migrations apply --persist-to .wrangler/e2e-state` — wrangler
// кладёт состояние в <путь>/v3, ровно туда же смотрит @cloudflare/vite-plugin
// (проверено: одинаковый hash-файл miniflare-D1DatabaseObject/*.sqlite).
// Сброс в команде, а не в globalSetup, чтобы не зависеть от порядка
// globalSetup/webServer и не трогать состояние уже запущенного сервера.
// Dev-состояние в .wrangler/state не затрагивается.
//
// Сервер — `vite build` + `vite preview` (production-сборка в workerd),
// а НЕ `vite dev`: CSP воркера (worker/http.ts, script-src 'self') блокирует
// inline-преамбулу @vitejs/plugin-react, и в dev-режиме React вообще не
// монтируется («@vitejs/plugin-react can't detect preamble») — это дев-баг
// продукта, зафиксирован в отчёте. Preview дополнительно ближе к продакшену:
// e2e проверяют настоящие собранные ассеты с настоящим CSP.
// .dev.vars (DEV_AUTH_EMAIL) копируется сборкой в dist и работает в preview.
const RESET_DB =
  'rm -rf .wrangler/e2e-state && ' +
  'pnpm exec wrangler d1 migrations apply task-carousel-db --local --persist-to .wrangler/e2e-state';

const BUILD = 'pnpm exec vite build --config vite.config.e2e.ts';

export default defineConfig({
  testDir: './e2e',
  // Тесты одного файла — единый сценарий поверх общей БД: строго последовательно.
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5198',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] }, // 412x915, touch, mobile UA
    },
  ],
  webServer: {
    command: `${RESET_DB} && ${BUILD} && pnpm exec vite preview --config vite.config.e2e.ts --port 5198 --strictPort`,
    url: 'http://localhost:5198/api/me',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
