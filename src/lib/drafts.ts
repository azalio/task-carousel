// Черновики записей прогресса: localStorage, ключ включает id задачи (§5).

const DRAFT_PREFIX = 'task-carousel:draft:';

export function draftKey(taskId: string): string {
  return `${DRAFT_PREFIX}${taskId}`;
}

export function loadDraft(taskId: string): string {
  try {
    return window.localStorage.getItem(draftKey(taskId)) ?? '';
  } catch {
    return '';
  }
}

export function saveDraft(taskId: string, text: string): void {
  try {
    if (text === '') {
      window.localStorage.removeItem(draftKey(taskId));
    } else {
      window.localStorage.setItem(draftKey(taskId), text);
    }
  } catch {
    // localStorage недоступен (private mode / переполнен) — черновик просто не сохранится
  }
}

export function clearDraft(taskId: string): void {
  try {
    window.localStorage.removeItem(draftKey(taskId));
  } catch {
    // ignore
  }
}
