// Детект горизонтального свайпа (§4.1).
// Порог: |dx| > 48px и |dx| > 2*|dy| — иначе жест считается скроллом/тапом.

export const SWIPE_MIN_DX = 48;

export type SwipeDirection = 'left' | 'right';

export function detectSwipe(
  dx: number,
  dy: number,
  minDx: number = SWIPE_MIN_DX,
): SwipeDirection | null {
  if (Math.abs(dx) <= minDx) return null;
  if (Math.abs(dx) <= 2 * Math.abs(dy)) return null;
  return dx < 0 ? 'left' : 'right';
}

// Жест, начатый в текстовом поле, не должен переключать карусель.
export function isTextInputElement(target: unknown): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  return (
    target.closest('textarea, input, select, [contenteditable=""], [contenteditable="true"]') !==
    null
  );
}

// При активном выделении текста свайп не срабатывает.
export function hasNonEmptySelection(
  selection: Pick<Selection, 'isCollapsed'> | null,
): boolean {
  return selection !== null && !selection.isCollapsed;
}
