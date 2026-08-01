import { useCallback, useEffect, useState } from 'react';
import type { ProgressEntry } from '../../shared/types';
import { api, errorMessage } from '../api';
import { BackIcon } from '../components/icons';
import { formatDateTime } from '../lib/format';

// История прогресса задачи (§4.5): записи от новых к старым,
// дата и локальное время пользователя.

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; entries: ProgressEntry[] };

interface HistoryScreenProps {
  taskId: string;
  taskTitle: string;
  onBack: () => void;
}

export function HistoryScreen({ taskId, taskTitle, onBack }: HistoryScreenProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const entries = await api.progress(taskId);
      setState({
        status: 'ready',
        entries: [...entries].sort((a, b) => b.createdAt - a.createdAt),
      });
    } catch (err) {
      setState({ status: 'error', message: errorMessage(err) });
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="screen">
      <header className="app-header">
        <button type="button" className="icon-btn" aria-label="Назад" onClick={onBack}>
          <BackIcon />
        </button>
        <h1 className="app-title" tabIndex={-1} data-view-heading>
          История прогресса
        </h1>
      </header>
      <p className="history-subtitle">{taskTitle}</p>

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

      {state.status === 'ready' &&
        (state.entries.length === 0 ? (
          <div className="empty-state">
            <p className="empty-hint">
              Записей пока нет. Вернитесь к задаче и добавьте первую запись прогресса.
            </p>
            <button type="button" className="btn btn-secondary" onClick={onBack}>
              Вернуться к задаче
            </button>
          </div>
        ) : (
          <ul className="task-list">
            {state.entries.map((entry) => (
              <li key={entry.id} className="task-item">
                <p className="entry-note">{entry.note}</p>
                <p className="entry-time">{formatDateTime(entry.createdAt)}</p>
              </li>
            ))}
          </ul>
        ))}
    </main>
  );
}
