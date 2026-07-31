// Unit-тесты чистой логики карусели (worker/carousel.ts) по docs/design.md §7.

import { describe, expect, it } from 'vitest';
import {
  compareActive,
  currentIndexOf,
  moveCurrent,
  nextAfterCheckIn,
  nextAfterComplete,
  resolveCurrentId,
  sortActive,
  type CarouselTaskRef,
} from '../../worker/carousel';

function task(id: string, position: number, created_at = 0): CarouselTaskRef {
  return { id, position, created_at };
}

const A = task('a', 1);
const B = task('b', 2);
const C = task('c', 3);
const D = task('d', 4);

describe('sortActive / compareActive', () => {
  it('сортирует по position ASC', () => {
    expect(sortActive([C, A, D, B]).map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('при равных position — tie-break по created_at ASC', () => {
    const x = task('x', 5, 200);
    const y = task('y', 5, 100);
    expect(sortActive([x, y]).map((t) => t.id)).toEqual(['y', 'x']);
  });

  it('при равных position и created_at — tie-break по id ASC', () => {
    const x = task('x', 5, 100);
    const y = task('y', 5, 100);
    expect(sortActive([y, x]).map((t) => t.id)).toEqual(['x', 'y']);
    expect(compareActive(x, x)).toBe(0);
  });

  it('не мутирует исходный массив', () => {
    const source = [C, A];
    sortActive(source);
    expect(source.map((t) => t.id)).toEqual(['c', 'a']);
  });
});

describe('resolveCurrentId', () => {
  const active = [A, B, C];

  it('валидная сохранённая задача остаётся текущей', () => {
    expect(resolveCurrentId(active, 'b')).toBe('b');
  });

  it('сохранённой нет в активных (завершена/чужая/удалена) → первая активная', () => {
    expect(resolveCurrentId(active, 'missing')).toBe('a');
  });

  it('сохранённая отсутствует (null) → первая активная', () => {
    expect(resolveCurrentId(active, null)).toBe('a');
  });

  it('нет активных задач → null', () => {
    expect(resolveCurrentId([], null)).toBeNull();
    expect(resolveCurrentId([], 'a')).toBeNull();
  });
});

describe('currentIndexOf', () => {
  it('возвращает индекс с нуля', () => {
    expect(currentIndexOf([A, B, C], 'a')).toBe(0);
    expect(currentIndexOf([A, B, C], 'c')).toBe(2);
  });

  it('неизвестный id → 0', () => {
    expect(currentIndexOf([A, B, C], 'zzz')).toBe(0);
  });
});

describe('moveCurrent', () => {
  const active = [A, B, C, D];

  it('next переключает на следующую', () => {
    expect(moveCurrent(active, 'a', 'next')).toBe('b');
    expect(moveCurrent(active, 'b', 'next')).toBe('c');
  });

  it('previous переключает на предыдущую', () => {
    expect(moveCurrent(active, 'c', 'previous')).toBe('b');
  });

  it('wrap: next за последней → первая', () => {
    expect(moveCurrent(active, 'd', 'next')).toBe('a');
  });

  it('wrap: previous перед первой → последняя', () => {
    expect(moveCurrent(active, 'a', 'previous')).toBe('d');
  });

  it('одна задача → она же в обе стороны', () => {
    expect(moveCurrent([A], 'a', 'next')).toBe('a');
    expect(moveCurrent([A], 'a', 'previous')).toBe('a');
  });

  it('пустая карусель или отсутствие текущей → null', () => {
    expect(moveCurrent([], 'a', 'next')).toBeNull();
    expect(moveCurrent(active, null, 'next')).toBeNull();
  });
});

describe('nextAfterCheckIn', () => {
  const active = [A, B, C];

  it('текущей становится следующая по циклу', () => {
    expect(nextAfterCheckIn(active, 'a')).toBe('b');
    expect(nextAfterCheckIn(active, 'b')).toBe('c');
  });

  it('после последней — первая', () => {
    expect(nextAfterCheckIn(active, 'c')).toBe('a');
  });

  it('единственная активная → она же', () => {
    expect(nextAfterCheckIn([A], 'a')).toBe('a');
  });

  it('check-in по задаче вне списка → первая активная', () => {
    expect(nextAfterCheckIn(active, 'missing')).toBe('a');
  });

  it('нет активных → null', () => {
    expect(nextAfterCheckIn([], 'a')).toBeNull();
  });
});

describe('nextAfterComplete', () => {
  it('первая активная с position больше завершённой', () => {
    // Завершили b (position 2); остались a(1), c(3), d(4) → следующая c.
    expect(nextAfterComplete([A, C, D], 2)).toBe('c');
  });

  it('нет задач с большей позицией → первая активная', () => {
    // Завершили d (position 4); остались a(1), b(2), c(3) → wrap на первую.
    expect(nextAfterComplete([A, B, C], 4)).toBe('a');
  });

  it('активных не осталось → null', () => {
    expect(nextAfterComplete([], 4)).toBeNull();
  });
});
