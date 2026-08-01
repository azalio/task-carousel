import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
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
  const [creating, setCreating] = useState(false);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({
    active: null,
    completed: null,
  });

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

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentTab: Tab) => {
    const tabs: Tab[] = ['active', 'completed'];
    const currentIndex = tabs.indexOf(currentTab);
    let nextTab: Tab | null = null;

    if (event.key === 'ArrowRight') nextTab = tabs[(currentIndex + 1) % tabs.length];
    if (event.key === 'ArrowLeft') {
      nextTab = tabs[(currentIndex - 1 + tabs.length) % tabs.length];
    }
    if (event.key === 'Home') nextTab = tabs[0];
    if (event.key === 'End') nextTab = tabs[tabs.length - 1];
    if (nextTab === null) return;

    event.preventDefault();
    setTab(nextTab);
    window.requestAnimationFrame(() => tabRefs.current[nextTab]?.focus());
  };

  return (
    <main className="screen">
      <header className="app-header">
        <button type="button" className="icon-btn" aria-label="Назад" onClick={onBack}>
          <BackIcon />
        </button>
        <h1 className="app-title" tabIndex={-1} data-view-heading>
          Все задачи
        </h1>
      </header>

      <div className="tabs" role="tablist" aria-label="Состояние задач">
        <button
          ref={(element) => {
            tabRefs.current.active = element;
          }}
          id="tasks-tab-active"
          type="button"
          role="tab"
          aria-selected={tab === 'active'}
          aria-controls="tasks-panel-active"
          tabIndex={tab === 'active' ? 0 : -1}
          className={tab === 'active' ? 'tab tab-active' : 'tab'}
          onClick={() => setTab('active')}
          onKeyDown={(event) => handleTabKeyDown(event, 'active')}
        >
          Активные{state.status === 'ready' ? ` (${active.length})` : ''}
        </button>
        <button
          ref={(element) => {
            tabRefs.current.completed = element;
          }}
          id="tasks-tab-completed"
          type="button"
          role="tab"
          aria-selected={tab === 'completed'}
          aria-controls="tasks-panel-completed"
          tabIndex={tab === 'completed' ? 0 : -1}
          className={tab === 'completed' ? 'tab tab-active' : 'tab'}
          onClick={() => setTab('completed')}
          onKeyDown={(event) => handleTabKeyDown(event, 'completed')}
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

      {state.status === 'ready' && (
        <div
          id="tasks-panel-active"
          className="tab-panel"
          role="tabpanel"
          aria-labelledby="tasks-tab-active"
          hidden={tab !== 'active'}
        >
          <ul className="task-list">
            {active.length === 0 && (
              <li className="list-empty">
                <p className="list-empty-title">Активных задач нет</p>
                <p className="list-empty-hint">
                  Добавьте задачу или верните выполненную в работу.
                </p>
                <div className="list-empty-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-small"
                    onClick={() => setCreating(true)}
                  >
                    Добавить задачу
                  </button>
                  {completed.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={() => setTab('completed')}
                    >
                      Посмотреть выполненные
                    </button>
                  )}
                </div>
              </li>
            )}
            {active.map((t) => (
              <li key={t.id} className="task-item">
                <h2 className="task-item-title">{t.title}</h2>
                {t.description !== '' && (
                  <p className="task-item-description">{t.description}</p>
                )}
                <p className="task-item-meta">
                  {t.lastProgressAt !== null
                    ? `Последний прогресс: ${formatDateTime(t.lastProgressAt)}`
                    : 'Прогресса пока нет'}
                  {' · '}
                  {t.progressCount}{' '}
                  {pluralRu(t.progressCount, ['запись', 'записи', 'записей'])}
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
        </div>
      )}

      {state.status === 'ready' && (
        <div
          id="tasks-panel-completed"
          className="tab-panel"
          role="tabpanel"
          aria-labelledby="tasks-tab-completed"
          hidden={tab !== 'completed'}
        >
          <ul className="task-list">
            {completed.length === 0 && (
              <li className="list-empty">
                <p className="list-empty-title">Выполненных задач нет</p>
                <p className="list-empty-hint">Здесь появятся задачи после завершения.</p>
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  onClick={() => setTab('active')}
                >
                  Показать активные
                </button>
              </li>
            )}
            {completed.map((t) => (
              <li key={t.id} className="task-item">
                <h2 className="task-item-title">{t.title}</h2>
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
        </div>
      )}

      {creating && (
        <TaskForm
          mode="create"
          online={online}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            onToast('Задача добавлена');
            void load();
          }}
        />
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
    </main>
  );
}
