import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { NOTE_MAX, type CarouselCurrent } from '../../shared/types';
import { api, errorMessage } from '../api';
import { UserMenu } from '../components/UserMenu';
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from '../components/icons';
import { clearDraft, loadDraft, saveDraft } from '../lib/drafts';
import { formatDateTime } from '../lib/format';
import { isTextInputElement } from '../lib/swipe';

// Главный экран — карусель (§4.1): одна активная задача, запись прогресса,
// свайпы/стрелки/клавиатура, завершение с toast-отменой (§5, §6).

type Direction = 'next' | 'previous';
type Pending = 'move' | 'checkin' | 'complete' | null;
type DragState = 'idle' | 'dragging' | 'settling';
interface DragStart {
  pointerId: number;
  startX: number;
  startY: number;
  width: number;
  active: boolean;
}
type CompletedInfo =
  | { status: 'loading' }
  | { status: 'ready'; count: number }
  | { status: 'error' };

interface CarouselScreenProps {
  current: CarouselCurrent;
  email: string | null;
  online: boolean;
  onCurrentChange: (current: CarouselCurrent) => void;
  onReloadCurrent: () => Promise<void>;
  onOpenTasks: (tab: 'active' | 'completed') => void;
  onOpenHistory: (taskId: string, taskTitle: string) => void;
  onOpenCreate: () => void;
  onToast: (message: string, action?: { label: string; run: () => void }) => void;
}

export function CarouselScreen({
  current,
  email,
  online,
  onCurrentChange,
  onReloadCurrent,
  onOpenTasks,
  onOpenHistory,
  onOpenCreate,
  onToast,
}: CarouselScreenProps) {
  const task = current.task;
  const taskId = task?.id ?? null;

  const [note, setNote] = useState(() => (taskId !== null ? loadDraft(taskId) : ''));
  const [noteSubmitted, setNoteSubmitted] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [slide, setSlide] = useState<'next' | 'prev' | null>(null);
  const [completedInfo, setCompletedInfo] = useState<CompletedInfo>({ status: 'loading' });
  const [completedRetry, setCompletedRetry] = useState(0);
  // Перетаскивание карточки (§4.1): она следует за пальцем/курсором, на отпускании
  // доезжает до соседней задачи (если за порогом) или отпружинивает назад.
  const [dragDx, setDragDx] = useState(0);
  const [dragState, setDragState] = useState<DragState>('idle');
  const dragRef = useRef<DragStart | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // При переключении задачи поднимаем её черновик — текст не теряется (§5).
  useEffect(() => {
    setNote(taskId !== null ? loadDraft(taskId) : '');
    setNoteSubmitted(false);
  }, [taskId]);

  // Новая карточка приходит по центру. Сброс до отрисовки (useLayoutEffect) —
  // иначе при reduced-motion входящая карточка на кадр осталась бы за экраном.
  useLayoutEffect(() => {
    setDragDx(0);
    setDragState('idle');
    dragRef.current = null;
  }, [taskId]);

  // Пустая карусель: чтобы отличить «все задачи завершены» от «задач ещё нет»,
  // нужно число выполненных.
  useEffect(() => {
    if (task) return;
    let alive = true;
    setCompletedInfo({ status: 'loading' });
    api
      .tasks('completed')
      .then((list) => {
        if (alive) setCompletedInfo({ status: 'ready', count: list.length });
      })
      .catch(() => {
        if (alive) setCompletedInfo({ status: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [task, completedRetry]);

  const handleNoteChange = (value: string) => {
    setNote(value);
    if (taskId !== null) saveDraft(taskId, value);
  };

  const move = async (direction: Direction) => {
    if (pending !== null || !online || current.total === 0) return;
    setPending('move');
    setError(null);
    try {
      const next = await api.carouselMove(direction);
      setSlide(direction === 'next' ? 'next' : 'prev');
      onCurrentChange(next);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  };

  const trimmedNote = note.trim();
  const noteEmpty = trimmedNote === '';
  const noteTooLong = trimmedNote.length > NOTE_MAX;
  const noteValidationError = noteTooLong
    ? `Запись не длиннее ${NOTE_MAX} символов`
    : noteSubmitted && noteEmpty
      ? 'Введите запись прогресса'
      : null;
  const canCheckIn = taskId !== null && pending === null && online;

  const checkIn = async () => {
    if (taskId === null || pending !== null || !online) return;
    setNoteSubmitted(true);
    if (noteEmpty || noteTooLong) {
      noteRef.current?.focus();
      return;
    }
    setPending('checkin');
    setError(null);
    try {
      const result = await api.checkIn(taskId, trimmedNote);
      clearDraft(taskId);
      setNote('');
      setNoteSubmitted(false);
      setSlide('next');
      onCurrentChange(result.current);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  };

  const undoComplete = async (completedTaskId: string) => {
    try {
      await api.reopenTask(completedTaskId);
      // Перезагрузку current делаем через защищённый guard'ом App: если за время
      // reopen+GET пользователь уже пролистнул карусель, устаревший ответ отбросится.
      await onReloadCurrent();
    } catch (err) {
      onToast(errorMessage(err));
    }
  };

  const complete = async () => {
    if (taskId === null || pending !== null || !online) return;
    setPending('complete');
    setError(null);
    try {
      const result = await api.completeTask(taskId);
      onCurrentChange(result.current);
      onToast('Задача завершена', {
        label: 'Отменить',
        run: () => void undoComplete(taskId),
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  };

  // Клавиатура (§4.1): стрелки — только вне текстовых полей; Ctrl/Cmd+Enter —
  // «Записать и дальше» (работает и из textarea). Ref — чтобы слушатель
  // вешался один раз, но видел актуальное состояние.
  const actionsRef = useRef({ move, checkIn });
  useEffect(() => {
    actionsRef.current = { move, checkIn };
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Поверх карусели может быть открыт модальный диалог (TaskForm). Его
      // хоткеи не должны пробивать в фоновую карусель: Ctrl/Cmd+Enter в форме
      // создал бы запись прогресса (необратимо), стрелки — пролистали бы карусель.
      if (document.querySelector('[aria-modal="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        void actionsRef.current.checkIn();
        return;
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (isTextInputElement(document.activeElement)) return;
      event.preventDefault();
      void actionsRef.current.move(event.key === 'ArrowRight' ? 'next' : 'previous');
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Перетаскивание карточки (§4.1) через Pointer Events — один код для касания,
  // мыши и пера. Порог активации отделяет горизонтальный жест от тапа/скролла.
  const DRAG_ACTIVATE = 10; // px до начала перетаскивания
  const tiltDeg = (dx: number) => Math.max(-8, Math.min(8, dx / 18)); // лёгкий наклон

  const releaseCapture = (event: PointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    // Только основная кнопка мыши / касание; жест из текстового поля игнорируем.
    if (event.button !== 0 || !task) return;
    if (isTextInputElement(event.target)) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: event.currentTarget.offsetWidth || 400,
      active: false,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.active) {
      // Активируем только при явном горизонтальном намерении — вертикаль отдаём скроллу.
      if (Math.abs(dx) < DRAG_ACTIVATE || Math.abs(dx) <= Math.abs(dy)) return;
      drag.active = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragState('dragging');
    }
    setDragDx(dx);
  };

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active) return; // это был тап — клик по карточке/ссылке обработается сам
    releaseCapture(event);
    const dx = event.clientX - drag.startX;
    const threshold = Math.max(64, drag.width * 0.3);
    const canCommit = pending === null && online && current.total > 1;
    const direction: Direction | null =
      Math.abs(dx) >= threshold ? (dx < 0 ? 'next' : 'previous') : null;
    setDragState('settling');
    if (direction && canCommit) {
      // Доводим карточку за экран в сторону жеста и переключаем задачу.
      setDragDx(dx < 0 ? -(drag.width + 120) : drag.width + 120);
      void move(direction);
    } else {
      setDragDx(0); // назад по центру (пружина)
    }
  };

  const handlePointerCancel = (event: PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !drag.active) return;
    releaseCapture(event);
    setDragState('settling');
    setDragDx(0);
  };

  const handleCardTransitionEnd = () => {
    setDragState((s) => (s === 'settling' ? 'idle' : s));
  };

  return (
    <main className="screen">
      <header className="app-header">
        <div className="app-title">Task Carousel</div>
        <div className="header-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label="Добавить задачу"
            onClick={onOpenCreate}
          >
            <PlusIcon />
          </button>
          <UserMenu email={email} onOpenTasks={() => onOpenTasks('active')} />
        </div>
      </header>

      {task ? (
        <>
          <p className="carousel-indicator">
            {current.currentIndex + 1} из {current.total}
          </p>
          <div className="carousel-body">
            <button
              type="button"
              className="arrow-btn arrow-left"
              aria-label="Предыдущая задача"
              disabled={pending !== null || !online}
              onClick={() => void move('previous')}
            >
              <ChevronLeftIcon />
            </button>
            <article
              key={task.id}
              className={
                [
                  'task-card',
                  dragState === 'dragging'
                    ? 'is-dragging'
                    : dragState === 'settling'
                      ? 'is-settling'
                      : '',
                  slide === 'next' ? 'card-enter-next' : slide === 'prev' ? 'card-enter-prev' : '',
                ]
                  .filter(Boolean)
                  .join(' ')
              }
              style={
                dragState === 'idle'
                  ? undefined
                  : {
                      transform: `translateX(${dragDx}px) rotate(${tiltDeg(dragDx)}deg)`,
                      opacity: dragState === 'settling' && dragDx !== 0 ? 0.6 : 1,
                    }
              }
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onTransitionEnd={handleCardTransitionEnd}
            >
              <h1 className="task-title" tabIndex={-1} data-view-heading>
                {task.title}
              </h1>
              {task.description !== '' && (
                <p className="task-description">{task.description}</p>
              )}
              {task.lastProgress ? (
                <div className="last-progress">
                  <p className="last-progress-label">Последнее:</p>
                  <p className="last-progress-note">{task.lastProgress.note}</p>
                  <p className="last-progress-time">
                    {formatDateTime(task.lastProgress.createdAt)}
                  </p>
                </div>
              ) : (
                <p className="last-progress-empty">Записей прогресса пока нет</p>
              )}
              <button
                type="button"
                className="link-btn"
                onClick={() => onOpenHistory(task.id, task.title)}
              >
                История прогресса
              </button>
            </article>
            <button
              type="button"
              className="arrow-btn arrow-right"
              aria-label="Следующая задача"
              disabled={pending !== null || !online}
              onClick={() => void move('next')}
            >
              <ChevronRightIcon />
            </button>
          </div>
          <div className="action-panel">
            {error !== null && (
              <p className="inline-error action-error" role="alert">
                {error}
              </p>
            )}
            <div className="note-field">
              <label className="note-label" htmlFor="progress-note">
                Что сделал и где остановился?
              </label>
              <textarea
                id="progress-note"
                ref={noteRef}
                className={noteValidationError ? 'note-input input-invalid' : 'note-input'}
                placeholder="Например: закончил черновик, дальше — ревью"
                rows={3}
                value={note}
                onChange={(event) => handleNoteChange(event.target.value)}
                disabled={pending === 'checkin'}
                aria-invalid={noteValidationError ? true : undefined}
                aria-describedby={noteValidationError ? 'progress-note-error' : undefined}
              />
              {noteValidationError && (
                <p id="progress-note-error" className="inline-error">
                  {noteValidationError}
                </p>
              )}
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canCheckIn}
              aria-busy={pending === 'checkin'}
              onClick={() => void checkIn()}
            >
              {pending === 'checkin' ? 'Записываю…' : 'Записать и дальше'}
            </button>
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={pending !== null || !online}
                onClick={() => void move('next')}
              >
                Пропустить
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={pending !== null || !online}
                aria-busy={pending === 'complete'}
                onClick={() => void complete()}
              >
                {pending === 'complete' ? 'Завершаю…' : 'Готово'}
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="empty-state">
          {completedInfo.status === 'loading' && (
            <>
              <h1 className="sr-only" tabIndex={-1} data-view-heading>
                Task Carousel
              </h1>
              <p className="muted">Загрузка…</p>
            </>
          )}
          {completedInfo.status === 'error' && (
            <>
              <h1 className="empty-title" tabIndex={-1} data-view-heading>
                Не удалось загрузить задачи
              </h1>
              <p className="inline-error">Не удалось загрузить данные</p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCompletedRetry((n) => n + 1)}
              >
                Повторить
              </button>
            </>
          )}
          {completedInfo.status === 'ready' &&
            (completedInfo.count > 0 ? (
              <>
                <h1 className="empty-title" tabIndex={-1} data-view-heading>
                  Все задачи завершены
                </h1>
                <p className="empty-hint">
                  Добавьте новую задачу или откройте выполненные.
                </p>
                <button type="button" className="btn btn-primary" onClick={onOpenCreate}>
                  Добавить новую задачу
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onOpenTasks('completed')}
                >
                  Посмотреть выполненные
                </button>
              </>
            ) : (
              <>
                <h1 className="empty-title" tabIndex={-1} data-view-heading>
                  Добро пожаловать!
                </h1>
                <p className="empty-hint">
                  Добавьте первую задачу — карусель будет показывать их по одной и
                  помогать записывать прогресс.
                </p>
                <button type="button" className="btn btn-primary" onClick={onOpenCreate}>
                  Добавить первую задачу
                </button>
              </>
            ))}
        </div>
      )}
    </main>
  );
}
