import { useCallback, useEffect, useState } from 'react';
import type { CarouselCurrent, TaskListItem } from '../../shared/types';
import { api, errorMessage } from '../api';
import { TaskForm } from '../components/TaskForm';
import { BackIcon } from '../components/icons';
import { formatDate, formatDateTime, pluralRu } from '../lib/format';

// Экран всех задач (§4.2): вкладки «Активные» / «Выполненные».
// Данные — GET /api/tasks?status=all, деление на клиенте.

type Tab = 'active' | 'completed';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; tasks: TaskListItem[] };

interface TasksScreenProps {
  initialTab: Tab;
  online: boolean;
  onBack: () => void;
  onOpenInCarousel: (current: CarouselCurrent) => void;
  onToast: (message: string) => void;
}

export function TasksScreen({
  initialTab,
  online,
  onBack,
  onOpenInCarousel,
  onToast,
}: TasksScreenProps) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ taskId: string; message: string } | null>(
    null,
  );
  const [editing, setEditing] = useState<TaskListItem | null>(null);

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      setState({ status: 'ready', tasks: await api.tasks('all') });
    } catch (err) {
      setState({ status: 'error', message: errorMessage(err) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openTask = async (taskId: string) => {
    if (pendingId !== null) return;
    setPendingId(taskId);
    setActionError(null);
    try {
      onOpenInCarousel(await api.carouselSelect(taskId));
    } catch (err) {
      setActionError({ taskId, message: errorMessage(err) });
    } finally {
      setPendingId(null);
    }
  };

  const reopenTask = async (taskId: string) => {
    if (pendingId !== null) return;
    setPendingId(taskId);
    setActionError(null);
    try {
      await api.reopenTask(taskId);
      onToast('Задача возвращена в работу');
      await load();
    } catch (err) {
      setActionError({ taskId, message: errorMessage(err) });
    } finally {
      setPendingId(null);
    }
  };

  const tasks = state.status === 'ready' ? state.tasks : [];
  const active = tasks
    .filter((t) => t.status === 'active')
    .sort((a, b) => a.position - b.position);
  const completed = tasks
    .filter((t) => t.status === 'completed')
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

  return (
    <div className="screen">
      <header className="app-header">
        <button type="button" className="icon-btn" aria-label="Назад" onClick={onBack}>
          <BackIcon />
        </button>
        <h1 className="app-title">Все задачи</h1>
      </header>

      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'active'}
          className={tab === 'active' ? 'tab tab-active' : 'tab'}
          onClick={() => setTab('active')}
        >
          Активные{state.status === 'ready' ? ` (${active.length})` : ''}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'completed'}
          className={tab === 'completed' ? 'tab tab-active' : 'tab'}
          onClick={() => setTab('completed')}
        >
          Выполненные{state.status === 'ready' ? ` (${completed.length})` : ''}
        </button>
      </div>

      {state.status === 'loading' && (
        <div className="empty-state">
          <p className="muted">Загрузка…</p>
        </div>
      )}

      {state.status === 'error' && (
        <div className="empty-state">
          <p className="inline-error" role="alert">
            {state.message}
          </p>
          <button type="button" className="btn btn-secondary" onClick={() => void load()}>
            Повторить
          </button>
        </div>
      )}

      {state.status === 'ready' && tab === 'active' && (
        <ul className="task-list">
          {active.length === 0 && <li className="muted list-empty">Активных задач нет</li>}
          {active.map((t) => (
            <li key={t.id} className="task-item">
              <h3 className="task-item-title">{t.title}</h3>
              {t.description !== '' && (
                <p className="task-item-description">{t.description}</p>
              )}
              <p className="task-item-meta">
                {t.lastProgressAt !== null
                  ? `Последний прогресс: ${formatDateTime(t.lastProgressAt)}`
                  : 'Прогресса пока нет'}
                {' · '}
                {t.progressCount} {pluralRu(t.progressCount, ['запись', 'записи', 'записей'])}
              </p>
              <div className="task-item-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={pendingId !== null || !online}
                  aria-busy={pendingId === t.id}
                  onClick={() => void openTask(t.id)}
                >
                  Открыть
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={pendingId !== null}
                  onClick={() => setEditing(t)}
                >
                  Редактировать
                </button>
              </div>
              {actionError?.taskId === t.id && (
                <p className="inline-error" role="alert">
                  {actionError.message}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {state.status === 'ready' && tab === 'completed' && (
        <ul className="task-list">
          {completed.length === 0 && (
            <li className="muted list-empty">Выполненных задач нет</li>
          )}
          {completed.map((t) => (
            <li key={t.id} className="task-item">
              <h3 className="task-item-title">{t.title}</h3>
              <p className="task-item-meta">
                {t.completedAt !== null
                  ? `Завершена: ${formatDate(t.completedAt)}`
                  : 'Завершена'}
              </p>
              <div className="task-item-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={pendingId !== null || !online}
                  aria-busy={pendingId === t.id}
                  onClick={() => void reopenTask(t.id)}
                >
                  Вернуть в работу
                </button>
              </div>
              {actionError?.taskId === t.id && (
                <p className="inline-error" role="alert">
                  {actionError.message}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <TaskForm
          mode="edit"
          initial={{ id: editing.id, title: editing.title, description: editing.description }}
          online={online}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onToast('Задача обновлена');
            void load();
          }}
        />
      )}
    </div>
  );
}
