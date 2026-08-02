import { readFile } from 'node:fs/promises';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const CLIENT_ROOT = resolve(fileURLToPath(new URL('../dist/client/', import.meta.url)));
const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

let accessGranted = true;
let appServer: Server | undefined;
let loginServer: Server | undefined;
let appOrigin = '';
let loginUrl = '';

function listen(server: Server): Promise<string> {
  return new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address() as AddressInfo;
      resolveListen(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server: Server | undefined): Promise<void> {
  if (!server) return Promise.resolve();
  return new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
}

function sendJson(response: ServerResponse, body: unknown): void {
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

async function sendStatic(pathname: string, response: ServerResponse): Promise<void> {
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = resolve(CLIENT_ROOT, relativePath);
  if (!filePath.startsWith(`${CLIENT_ROOT}${sep}`)) {
    response.writeHead(404).end();
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      'Cache-Control': 'max-age=0',
      'Content-Type': CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
      ...(pathname === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {}),
    });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
}

async function openControlledApp(page: Page): Promise<void> {
  await page.goto(appOrigin, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Тестовая задача' })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

test.beforeAll(async () => {
  loginServer = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><h1>Войти в Cloudflare Access</h1>');
  });
  const loginOrigin = await listen(loginServer);
  loginUrl = `${loginOrigin}/login`;

  appServer = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://app.test');
      if (!accessGranted && (url.pathname === '/' || url.pathname.startsWith('/api/'))) {
        response.writeHead(302, { Location: loginUrl }).end();
        return;
      }

      if (url.pathname === '/api/me') {
        sendJson(response, { email: 'test@example.com' });
        return;
      }
      if (url.pathname === '/api/carousel/current') {
        sendJson(response, {
          task: {
            id: 'task-1',
            title: 'Тестовая задача',
            description: '',
            lastProgress: null,
          },
          currentIndex: 0,
          total: 1,
        });
        return;
      }
      if (url.pathname === '/api/carousel/move') {
        sendJson(response, {
          task: {
            id: 'task-1',
            title: 'Тестовая задача',
            description: '',
            lastProgress: null,
          },
          currentIndex: 0,
          total: 1,
        });
        return;
      }

      await sendStatic(url.pathname, response);
    })().catch(() => response.writeHead(500).end());
  });
  appOrigin = await listen(appServer);
});

test.afterAll(async () => {
  await Promise.all([close(appServer), close(loginServer)]);
});

test.beforeEach(() => {
  accessGranted = true;
});

test('истёкшая Access-сессия выводит на повторный вход вместо кешированной оболочки', async ({
  page,
}) => {
  await openControlledApp(page);

  accessGranted = false;
  await page.reload({ waitUntil: 'load' });

  await expect(page).toHaveURL(loginUrl);
  await expect(page.getByRole('heading', { name: 'Войти в Cloudflare Access' })).toBeVisible();
});

test('истёкшая сессия во время работы предлагает войти снова', async ({ page }) => {
  await openControlledApp(page);

  accessGranted = false;
  await page.getByRole('button', { name: 'Пропустить' }).click();

  await expect(page.getByRole('heading', { name: 'Сессия истекла' })).toBeVisible();
  await expect(page.getByText('Войдите снова, чтобы продолжить работу.')).toBeVisible();
  await page.getByRole('button', { name: 'Войти снова' }).click();
  await expect(page).toHaveURL(loginUrl);
});

test('при настоящем offline кешированная оболочка остаётся доступна', async ({
  context,
  page,
}) => {
  await openControlledApp(page);
  // Первый контролируемый запуск докэширует хэшированные JS/CSS через service worker.
  await page.reload({ waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Тестовая задача' })).toBeVisible();

  await context.setOffline(true);
  await page.reload({ waitUntil: 'load' });

  await expect(page).toHaveURL(`${appOrigin}/`);
  await expect(page.getByRole('heading', { name: 'Не удалось загрузить Task Carousel' })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Нет подключения к интернету');
});
