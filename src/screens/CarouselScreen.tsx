import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { NOTE_MAX, type CarouselCurrent } from '../../shared/types';
import { api, errorMessage } from '../api';
import { UserMenu } from '../components/UserMenu';
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from '../components/icons';
import { clearDraft, loadDraft, saveDraft } from '../lib/drafts';
import { formatDateTime } from '../lib/format';
import { detectSwipe, hasNonEmptySelection, isTextInputElement } from '../lib/swipe';

// Главный экран — карусель (§4.1): одна активная задача, запись прогресса,
// свайпы/стрелки/клавиатура, завершение с toast-отменой (§5, §6).

type Direction = 'next' | 'previous';
type Pending = 'move' | 'checkin' | 'complete' | null;
type CompletedInfo =
  | { status: 'loading' }
  | { status: 'ready'; count: number }
  | { status: 'error' };

interface CarouselScreenProps {
  current: CarouselCurrent;
  email: string | null;
  online: boolean;
  onCurrentChange: (current: CarouselCurrent) => void;
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
  onOpenTasks,
  onOpenHistory,
  onOpenCreate,
  onToast,
}: CarouselScreenProps) {
  const task = current.task;
  const taskId = task?.id ?? null;

  const [note, setNote] = useState(() => (taskId !== null ? loadDraft(taskId) : ''));
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);
  const [slide, setSlide] = useState<'next' | 'prev' | null>(null);
  const [completedInfo, setCompletedInfo] = useState<CompletedInfo>({ status: 'loading' });
  const [completedRetry, setCompletedRetry] = useState(0);
  const touchStart = useRef<{ x: number; y: number; ignore: boolean } | null>(null);

  // При переключении задачи поднимаем её черновик — текст не теряется (§5).
  useEffect(() => {
    setNote(taskId !== null ? loadDraft(taskId) : '');
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
    if (pending !== null || current.total === 0) return;
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
  const noteTooLong = trimmedNote.length > NOTE_MAX;
  const canCheckIn =
    taskId !== null && pending === null && online && trimmedNote !== '' && !noteTooLong;

  const checkIn = async () => {
    if (taskId === null || pending !== null || !online) return;
    if (trimmedNote === '' || noteTooLong) return;
    setPending('checkin');
    setError(null);
    try {
      const result = await api.checkIn(taskId, trimmedNote);
      clearDraft(taskId);
      setNote('');
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
      onCurrentChange(await api.carouselCurrent());
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

  // Свайпы (§4.1): не из текстового поля и не при активном выделении текста.
  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (!touch) return;
    touchStart.current = {
      x: touch.clientX,
      y: touch.clientY,
      ignore: isTextInputElement(event.target),
    };
  };

  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start || start.ignore) return;
    if (hasNonEmptySelection(window.getSelection())) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const direction = detectSwipe(touch.clientX - start.x, touch.clientY - start.y);
    if (direction === 'left') void move('next');
    else if (direction === 'right') void move('previous');
  };

  return (
    <div className="screen">
      <header className="app-header">
        <h1 className="app-title">Task Carousel</h1>
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
          <div
            className="carousel-body"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <button
              type="button"
              className="arrow-btn arrow-left"
              aria-label="Предыдущая задача"
              disabled={pending !== null}
              onClick={() => void move('previous')}
            >
              <ChevronLeftIcon />
            </button>
            <article
              key={task.id}
              className={
                slide === 'next'
                  ? 'task-card card-enter-next'
                  : slide === 'prev'
                    ? 'task-card card-enter-prev'
                    : 'task-card'
              }
            >
              <h2 className="task-title">{task.title}</h2>
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
              disabled={pending !== null}
              onClick={() => void move('next')}
            >
              <ChevronRightIcon />
            </button>
          </div>
          <div className="action-panel">
            {error !== null && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            {noteTooLong && (
              <p className="inline-error">Запись не длиннее {NOTE_MAX} символов</p>
            )}
            <textarea
              className="note-input"
              placeholder="Что сделал и где остановился?"
              aria-label="Что сделал и где остановился?"
              rows={3}
              value={note}
              onChange={(event) => handleNoteChange(event.target.value)}
              disabled={pending === 'checkin'}
            />
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
          {completedInfo.status === 'loading' && <p className="muted">Загрузка…</p>}
          {completedInfo.status === 'error' && (
            <>
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
                <h2 className="empty-title">Все задачи завершены</h2>
                <p className="empty-hint">
                  Отличная работа! Добавьте новую задачу или посмотрите выполненные.
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
                <h2 className="empty-title">Добро пожаловать!</h2>
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
    </div>
  );
}
