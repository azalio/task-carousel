import { expect, test, type Page } from '@playwright/test';

// Основной сценарий ТЗ (docs/design.md §1) в мобильном вьюпорте.
// Селекторы — только роли и русские тексты из ТЗ (data-testid в разметке нет).
// БД чистая на каждый ПРОГОН (см. playwright.config.ts), поэтому тесты файла
// идут строго последовательно и продолжают состояние друг друга.

test.describe.configure({ mode: 'serial' });

const noteField = (page: Page) =>
  page.getByRole('textbox', { name: 'Что сделал и где остановился?' });

const heading = (page: Page, name: string) => page.getByRole('heading', { name });

async function createTaskViaHeader(page: Page, title: string, description = '') {
  await page.getByRole('button', { name: 'Добавить задачу' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Название').fill(title);
  if (description !== '') await dialog.getByLabel('Описание').fill(description);
  await dialog.getByRole('button', { name: 'Добавить' }).click();
  await expect(dialog).toBeHidden();
}

async function checkIn(page: Page, note: string, expectNextTitle: string) {
  await noteField(page).fill(note);
  await page.getByRole('button', { name: 'Записать и дальше' }).click();
  await expect(heading(page, expectNextTitle)).toBeVisible();
  await expect(noteField(page)).toHaveValue('');
}

// Перетаскивание карточки влево (§4.1): стрелок на мобильном нет — тянем саму
// карточку мышью за порог коммита (dx < -30% ширины, dy = 0), она уезжает к следующей.
async function dragCardLeft(page: Page) {
  const box = await page.locator('.task-card').boundingBox();
  if (!box) throw new Error('нет карточки для перетаскивания');
  const y = box.y + box.height / 2;
  const startX = box.x + box.width * 0.7;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  // Несколько шагов, чтобы пересечь порог активации и уехать за порог коммита.
  await page.mouse.move(startX - 40, y, { steps: 4 });
  await page.mouse.move(box.x + box.width * 0.1, y, { steps: 6 });
  await page.mouse.up();
}

test('основной сценарий: 4 задачи, check-in по кругу, черновик, завершение и возврат', async ({
  page,
}) => {
  await page.goto('/');

  // Чистая база: приветственный экран.
  await expect(heading(page, 'Добро пожаловать!')).toBeVisible();
  await page.getByRole('button', { name: 'Добавить первую задачу' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Название').fill('Задача 1');
  await dialog.getByLabel('Описание').fill('Описание первой задачи');
  await dialog.getByRole('button', { name: 'Добавить' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Задача добавлена' })).toBeVisible();
  await expect(heading(page, 'Задача 1')).toBeVisible();
  await expect(page.getByText('1 из 1')).toBeVisible();
  await expect(page.getByText('Описание первой задачи')).toBeVisible();

  // Ещё три задачи — уходят в конец, текущая не переключается (§4.3).
  await createTaskViaHeader(page, 'Задача 2');
  await createTaskViaHeader(page, 'Задача 3');
  await createTaskViaHeader(page, 'Задача 4');
  await expect(page.getByText('1 из 4')).toBeVisible();
  await expect(heading(page, 'Задача 1')).toBeVisible();

  // «Записать и дальше»: прогресс + переход к следующей; после 4-й — первая (§1, §5).
  await checkIn(page, 'Прогресс по задаче 1', 'Задача 2');
  await expect(page.getByText('2 из 4')).toBeVisible();
  await checkIn(page, 'Прогресс по задаче 2', 'Задача 3');
  await checkIn(page, 'Прогресс по задаче 3', 'Задача 4');
  await checkIn(page, 'Прогресс по задаче 4', 'Задача 1');
  await expect(page.getByText('1 из 4')).toBeVisible();
  // На карточке видна последняя запись.
  await expect(page.getByText('Последнее:')).toBeVisible();
  await expect(page.getByText('Прогресс по задаче 1')).toBeVisible();

  // «Пропустить» переключает без записи (§5).
  await page.getByRole('button', { name: 'Пропустить' }).click();
  await expect(heading(page, 'Задача 2')).toBeVisible();

  // Черновик (§5): текст не теряется при переключении между задачами.
  await noteField(page).fill('незаписанный черновик');
  await dragCardLeft(page); // перетаскивание влево → следующая
  await expect(heading(page, 'Задача 3')).toBeVisible();
  await expect(noteField(page)).toHaveValue('');
  await page.getByRole('button', { name: 'Пропустить' }).click();
  await expect(heading(page, 'Задача 4')).toBeVisible();
  await page.getByRole('button', { name: 'Пропустить' }).click();
  await expect(heading(page, 'Задача 1')).toBeVisible();
  await page.getByRole('button', { name: 'Пропустить' }).click();
  await expect(heading(page, 'Задача 2')).toBeVisible();
  await expect(noteField(page)).toHaveValue('незаписанный черновик');

  // «Готово» (§6): toast с «Отменить», задача исключена из карусели.
  await page.getByRole('button', { name: 'Готово' }).click();
  const completeToast = page.getByRole('status').filter({ hasText: 'Задача завершена' });
  await expect(completeToast).toBeVisible();
  await expect(completeToast.getByRole('button', { name: 'Отменить' })).toBeVisible();
  // Завершили «Задачу 2» (позиция 2) → следующая «Задача 3», осталось 3.
  await expect(heading(page, 'Задача 3')).toBeVisible();
  await expect(page.getByText('2 из 3')).toBeVisible();

  // Завершаем остальные до пустой карусели.
  await page.getByRole('button', { name: 'Готово' }).click();
  await expect(heading(page, 'Задача 4')).toBeVisible();
  await expect(page.getByText('2 из 2')).toBeVisible();
  await page.getByRole('button', { name: 'Готово' }).click();
  await expect(heading(page, 'Задача 1')).toBeVisible();
  await expect(page.getByText('1 из 1')).toBeVisible();
  await page.getByRole('button', { name: 'Готово' }).click();
  await expect(heading(page, 'Все задачи завершены')).toBeVisible();

  // «Посмотреть выполненные» → вкладка выполненных со всеми четырьмя.
  await page.getByRole('button', { name: 'Посмотреть выполненные' }).click();
  await expect(heading(page, 'Все задачи')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Выполненные (4)' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Вернуть в работу' })).toHaveCount(4);

  // «Вернуть в работу» → задача снова в карусели (§6).
  await page
    .locator('.task-item', { hasText: 'Задача 1' })
    .getByRole('button', { name: 'Вернуть в работу' })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Задача возвращена в работу' }),
  ).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Активные (1)' })).toBeVisible();
  await page.getByRole('button', { name: 'Назад' }).click();
  await expect(heading(page, 'Задача 1')).toBeVisible();
  await expect(page.getByText('1 из 1')).toBeVisible();
});

test('экран «Все задачи»: вкладки и «Открыть» ведёт на карусель с нужной задачей', async ({
  page,
}) => {
  // Состояние после первого теста: активна «Задача 1», выполнены 2, 3, 4.
  await page.goto('/');
  await expect(heading(page, 'Задача 1')).toBeVisible();

  // Экран открывается из меню пользователя.
  await page.getByRole('button', { name: 'Меню пользователя' }).click();
  await page.getByRole('menuitem', { name: 'Все задачи' }).click();
  await expect(heading(page, 'Все задачи')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Активные (1)' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // У «Задачи 1» одна запись прогресса из первого теста.
  await expect(page.locator('.task-item', { hasText: 'Задача 1' })).toContainText('1 запись');

  // Возвращаем «Задачу 4» в работу — теперь активных две.
  await page.getByRole('tab', { name: 'Выполненные (3)' }).click();
  await page
    .locator('.task-item', { hasText: 'Задача 4' })
    .getByRole('button', { name: 'Вернуть в работу' })
    .click();
  await expect(page.getByRole('tab', { name: 'Активные (2)' })).toBeVisible();
  await page.getByRole('tab', { name: 'Активные (2)' }).click();

  // «Открыть» делает задачу текущей в карусели.
  await page
    .locator('.task-item', { hasText: 'Задача 4' })
    .getByRole('button', { name: 'Открыть' })
    .click();
  await expect(heading(page, 'Задача 4')).toBeVisible();
  await expect(page.getByText('2 из 2')).toBeVisible();
});

test('история прогресса: запись после check-in видна, новые сверху', async ({ page }) => {
  // Состояние после второго теста: текущая — «Задача 4», активны 1 и 4.
  await page.goto('/');
  await expect(heading(page, 'Задача 4')).toBeVisible();

  await checkIn(page, 'запись для истории', 'Задача 1');
  await page.getByRole('button', { name: 'Пропустить' }).click();
  await expect(heading(page, 'Задача 4')).toBeVisible();

  await page.getByRole('button', { name: 'История прогресса' }).click();
  await expect(heading(page, 'История прогресса')).toBeVisible();
  await expect(page.getByText('Задача 4')).toBeVisible();
  // Новые сверху: свежая запись, под ней запись из первого теста.
  await expect(page.locator('.entry-note').first()).toHaveText('запись для истории');
  await expect(page.locator('.entry-note').nth(1)).toHaveText('Прогресс по задаче 4');
});

test('интерфейс доступен с клавиатуры и сохраняет контент в крайних viewport', async ({
  page,
}) => {
  // Состояние после основных сценариев: текущая «Задача 4», активны задачи 1 и 4.
  await page.goto('/');
  await expect(heading(page, 'Задача 4')).toBeVisible();
  await expect(page.locator('main')).toHaveCount(1);

  // Валидация основной записи доступна после submit и связана с полем.
  const note = noteField(page);
  const checkInButton = page.getByRole('button', { name: 'Записать и дальше' });
  await expect(checkInButton).toBeEnabled();
  await checkInButton.click();
  await expect(note).toBeFocused();
  await expect(note).toHaveAttribute('aria-invalid', 'true');
  await expect(note).toHaveAttribute('aria-describedby', 'progress-note-error');
  await expect(page.getByText('Введите запись прогресса')).toBeVisible();
  await note.fill('черновик для проверки модального окна');

  // Нативный modal dialog удерживает фокус и возвращает его на кнопку открытия.
  const addButton = page.getByRole('button', { name: 'Добавить задачу' });
  await addButton.focus();
  await addButton.press('Enter');
  let dialog = page.getByRole('dialog');
  const titleInput = dialog.getByLabel('Название');
  await expect(titleInput).toBeFocused();
  await titleInput.fill('Не создавать');
  await titleInput.press('Control+Enter');
  await expect(dialog).toBeVisible();
  await expect(note).toHaveValue('черновик для проверки модального окна');
  await page.keyboard.press('Shift+Tab');
  expect(
    await dialog.evaluate((element) => element.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(addButton).toBeFocused();

  await addButton.click();
  dialog = page.getByRole('dialog');
  const invalidTitle = dialog.getByLabel('Название');
  await dialog.getByRole('button', { name: 'Добавить' }).click();
  await expect(invalidTitle).toBeFocused();
  await expect(invalidTitle).toHaveAccessibleName('Название');
  await expect(invalidTitle).toHaveAttribute('aria-invalid', 'true');
  await expect(invalidTitle).toHaveAttribute('aria-describedby', 'task-title-error');
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await expect(addButton).toBeFocused();

  // Menu button и tabs следуют APG-клавиатуре; смена view обновляет title и фокус.
  const menuButton = page.getByRole('button', { name: 'Меню пользователя' });
  await menuButton.focus();
  await menuButton.press('ArrowDown');
  const allTasksItem = page.getByRole('menuitem', { name: 'Все задачи' });
  await expect(allTasksItem).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menuButton).toBeFocused();
  await menuButton.press('ArrowDown');
  await allTasksItem.press('Enter');

  const tasksHeading = heading(page, 'Все задачи');
  await expect(tasksHeading).toBeFocused();
  await expect(page).toHaveTitle('Все задачи · Task Carousel');
  await expect(page.locator('main')).toHaveCount(1);

  const activeTab = page.getByRole('tab', { name: 'Активные (2)' });
  const completedTab = page.getByRole('tab', { name: 'Выполненные (2)' });
  await activeTab.focus();
  await activeTab.press('ArrowRight');
  await expect(completedTab).toBeFocused();
  await expect(completedTab).toHaveAttribute('aria-selected', 'true');
  await expect(completedTab).toHaveAttribute('tabindex', '0');
  await expect(activeTab).toHaveAttribute('tabindex', '-1');

  await page.getByRole('button', { name: 'Назад' }).click();
  await expect(heading(page, 'Задача 4')).toBeFocused();
  await page.getByRole('button', { name: 'История прогресса' }).click();
  await expect(heading(page, 'История прогресса')).toBeFocused();
  await expect(page).toHaveTitle('История: Задача 4 · Task Carousel');
  await page.getByRole('button', { name: 'Назад' }).click();
  await expect(heading(page, 'Задача 4')).toBeFocused();

  // Карточка лежит непосредственно над полем ввода в зоне большого пальца.
  await page.setViewportSize({ width: 390, height: 844 });
  const portraitCardBox = await page.locator('.task-card').boundingBox();
  const portraitNoteBox = await note.boundingBox();
  expect(portraitCardBox).not.toBeNull();
  expect(portraitNoteBox).not.toBeNull();
  const cardToNoteGap = portraitNoteBox!.y - (portraitCardBox!.y + portraitCardBox!.height);
  expect(cardToNoteGap).toBeGreaterThanOrEqual(0);
  expect(cardToNoteGap).toBeLessThanOrEqual(64);

  // Focus ring остаётся системно видимым в forced-colors.
  await page.emulateMedia({ forcedColors: 'active' });
  await note.focus();
  const focusStyle = await note.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(focusStyle.style).not.toBe('none');
  expect(Number.parseFloat(focusStyle.width)).toBeGreaterThanOrEqual(2);
  await page.emulateMedia({ forcedColors: 'none' });

  // В landscape заголовок задачи не прячется под action panel.
  await page.setViewportSize({ width: 568, height: 320 });
  const titleBox = await heading(page, 'Задача 4').boundingBox();
  const actionBox = await page.locator('.action-panel').boundingBox();
  expect(titleBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  expect(titleBox!.y).toBeGreaterThanOrEqual(0);
  expect(titleBox!.y + titleBox!.height).toBeLessThan(actionBox!.y);

  // На desktop стрелки стоят рядом с центральной карточкой, а не у краёв окна.
  await page.setViewportSize({ width: 1280, height: 800 });
  const cardBox = await page.locator('.task-card').boundingBox();
  const leftArrowBox = await page.getByRole('button', { name: 'Предыдущая задача' }).boundingBox();
  const rightArrowBox = await page.getByRole('button', { name: 'Следующая задача' }).boundingBox();
  expect(cardBox).not.toBeNull();
  expect(leftArrowBox).not.toBeNull();
  expect(rightArrowBox).not.toBeNull();
  expect(cardBox!.x - (leftArrowBox!.x + leftArrowBox!.width)).toBeLessThanOrEqual(24);
  expect(rightArrowBox!.x - (cardBox!.x + cardBox!.width)).toBeLessThanOrEqual(24);
  expect(
    Math.abs(
      leftArrowBox!.y + leftArrowBox!.height / 2 - (cardBox!.y + cardBox!.height / 2),
    ),
  ).toBeLessThanOrEqual(3);

  // Пятисекундный Undo не исчезает, пока клавиатурный фокус находится в toast.
  await page.getByRole('button', { name: 'Готово' }).click();
  const completeToast = page.getByRole('status').filter({ hasText: 'Задача завершена' });
  const undoButton = completeToast.getByRole('button', { name: 'Отменить' });
  await undoButton.focus();
  await page.waitForTimeout(5_200);
  await expect(completeToast).toBeVisible();
  await undoButton.press('Enter');
  await expect(completeToast).toBeHidden();
});
