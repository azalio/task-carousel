// Чистые функции логики карусели (docs/design.md §5–7), без обращения к БД —
// покрываются unit-тестами. Все функции принимают УЖЕ отсортированный список
// активных задач (position ASC, tie-break: created_at, id); sortActive — эталон
// этой сортировки.

export interface CarouselTaskRef {
  id: string;
  position: number;
  created_at: number;
}

export function compareActive(a: CarouselTaskRef, b: CarouselTaskRef): number {
  if (a.position !== b.position) return a.position - b.position;
  if (a.created_at !== b.created_at) return a.created_at - b.created_at;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortActive<T extends CarouselTaskRef>(tasks: readonly T[]): T[] {
  return [...tasks].sort(compareActive);
}

// Разрешение текущей задачи: сохранённая валидна (есть в активных) → она;
// невалидна (нет/завершена/чужая) → первая активная; активных нет → null.
export function resolveCurrentId(
  sortedActive: readonly CarouselTaskRef[],
  savedId: string | null,
): string | null {
  if (sortedActive.length === 0) return null;
  if (savedId !== null && sortedActive.some((task) => task.id === savedId)) return savedId;
  return sortedActive[0].id;
}

// Индекс текущей задачи (с нуля); если id не найден — 0.
export function currentIndexOf(
  sortedActive: readonly CarouselTaskRef[],
  currentId: string,
): number {
  const index = sortedActive.findIndex((task) => task.id === currentId);
  return index >= 0 ? index : 0;
}

// Циклический сдвиг: после последней — первая, перед первой — последняя.
export function moveCurrent(
  sortedActive: readonly CarouselTaskRef[],
  currentId: string | null,
  direction: 'next' | 'previous',
): string | null {
  const count = sortedActive.length;
  if (count === 0 || currentId === null) return null;
  const index = currentIndexOf(sortedActive, currentId);
  const nextIndex = direction === 'next' ? (index + 1) % count : (index - 1 + count) % count;
  return sortedActive[nextIndex].id;
}

// После check-in текущей становится следующая активная по циклу
// (задача остаётся активной; если активная одна — она же).
export function nextAfterCheckIn(
  sortedActive: readonly CarouselTaskRef[],
  checkedInTaskId: string,
): string | null {
  const count = sortedActive.length;
  if (count === 0) return null;
  const index = sortedActive.findIndex((task) => task.id === checkedInTaskId);
  if (index < 0) return sortedActive[0].id;
  return sortedActive[(index + 1) % count].id;
}

// После завершения (§7): первая активная с position > позиции завершённой;
// если таких нет — первая активная; активных не осталось — null.
// sortedRemaining — активные задачи уже БЕЗ завершённой.
export function nextAfterComplete(
  sortedRemaining: readonly CarouselTaskRef[],
  completedPosition: number,
): string | null {
  if (sortedRemaining.length === 0) return null;
  const next = sortedRemaining.find((task) => task.position > completedPosition);
  return (next ?? sortedRemaining[0]).id;
}
