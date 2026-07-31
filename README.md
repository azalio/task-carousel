# Task Carousel

Мобильное веб-приложение для последовательной работы над параллельными задачами: видна одна текущая задача, фиксируешь прогресс — «Записать и дальше» — открывается следующая. ТЗ: [docs/design.md](docs/design.md).

Продакшен: https://todo.azalio.net (закрыт Cloudflare Access, вход по одноразовому коду на email).

## Стек

TypeScript, React 19, Vite, Cloudflare Worker (Hono) + D1, `@cloudflare/vite-plugin`, Cloudflare Access (jose для проверки JWT), PWA. Тесты: Vitest (unit + `@cloudflare/vitest-pool-workers`) и Playwright.

## Разработка

```sh
pnpm install
cp .dev.vars.example .dev.vars   # DEV_AUTH_EMAIL выключает Access-проверку локально
pnpm exec wrangler d1 migrations apply task-carousel-db --local
pnpm dev
```

## Тесты

```sh
pnpm test        # vitest: unit + worker API против miniflare D1
pnpm test:e2e    # playwright (сам поднимает dev-сервер)
pnpm typecheck
```

## Деплой

```sh
pnpm exec wrangler d1 migrations apply task-carousel-db --remote   # при новых миграциях
pnpm deploy
```

Worker: `task-carousel`, домен `todo.azalio.net` (custom domain, workers.dev и preview URLs выключены). Авторизация: Cloudflare Access-приложение `todo.azalio.net` (team `azalio.cloudflareaccess.com`), политика `azalio-local`; AUD прописан в `wrangler.jsonc` (`ACCESS_AUD`). Worker проверяет подпись JWT из `Cf-Access-Jwt-Assertion` (iss/aud/exp/nbf) и берёт email пользователя только из токена.
