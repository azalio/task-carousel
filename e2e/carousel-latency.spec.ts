import { expect, test, type Page } from '@playwright/test';

const task = (id: string, title: string) => ({
  id,
  title,
  description: '',
  lastProgress: null,
});

const taskA = task('a', 'Карточка A');
const taskB = task('b', 'Карточка B');

const currentA = {
  task: taskA,
  previousTask: taskB,
  nextTask: taskB,
  currentIndex: 0,
  total: 2,
};

const currentB = {
  task: taskB,
  previousTask: taskA,
  nextTask: taskA,
  currentIndex: 1,
  total: 2,
};

async function dragCardLeft(page: Page): Promise<void> {
  const box = await page.locator('.task-card').boundingBox();
  if (!box) throw new Error('нет карточки для перетаскивания');
  const y = box.y + box.height / 2;
  const startX = box.x + box.width * 0.7;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(startX - 40, y, { steps: 4 });
  await page.mouse.move(box.x + box.width * 0.1, y, { steps: 6 });
  await page.mouse.up();
}

test('свайп показывает соседнюю карточку до завершения move API', async ({ page }) => {
  let markMoveStarted!: () => void;
  const moveStarted = new Promise<void>((resolve) => {
    markMoveStarted = resolve;
  });
  let releaseMove!: () => void;
  const moveResponseGate = new Promise<void>((resolve) => {
    releaseMove = resolve;
  });

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      await route.fulfill({ json: { email: 'test@example.com' } });
      return;
    }
    if (url.pathname === '/api/carousel/current') {
      await route.fulfill({ json: currentA });
      return;
    }
    if (url.pathname === '/api/carousel/move') {
      markMoveStarted();
      await moveResponseGate;
      await route.fulfill({ json: currentB });
      return;
    }
    await route.fulfill({
      status: 404,
      json: { error: { code: 'NOT_FOUND', message: 'Маршрут не найден' } },
    });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Карточка A' })).toBeVisible();

  await dragCardLeft(page);
  await moveStarted;
  try {
    await expect(page.getByRole('heading', { name: 'Карточка B' })).toBeVisible({ timeout: 250 });
  } finally {
    releaseMove();
  }

  await expect(page.getByRole('button', { name: 'Пропустить' })).toBeEnabled();
});

test('ошибка move API откатывает оптимистичный свайп', async ({ page }) => {
  let markMoveStarted!: () => void;
  const moveStarted = new Promise<void>((resolve) => {
    markMoveStarted = resolve;
  });
  let releaseMove!: () => void;
  const moveResponseGate = new Promise<void>((resolve) => {
    releaseMove = resolve;
  });

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/me') {
      await route.fulfill({ json: { email: 'test@example.com' } });
      return;
    }
    if (url.pathname === '/api/carousel/current') {
      await route.fulfill({ json: currentA });
      return;
    }
    if (url.pathname === '/api/carousel/move') {
      markMoveStarted();
      await moveResponseGate;
      await route.fulfill({
        status: 500,
        json: {
          error: { code: 'INTERNAL_ERROR', message: 'Не удалось сохранить позицию' },
        },
      });
      return;
    }
    await route.fulfill({
      status: 404,
      json: { error: { code: 'NOT_FOUND', message: 'Маршрут не найден' } },
    });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Карточка A' })).toBeVisible();

  await dragCardLeft(page);
  await moveStarted;
  try {
    await expect(page.getByRole('heading', { name: 'Карточка B' })).toBeVisible({ timeout: 250 });
  } finally {
    releaseMove();
  }

  await expect(page.getByRole('heading', { name: 'Карточка A' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('Не удалось сохранить позицию');
});
