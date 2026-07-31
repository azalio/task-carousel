import { useCallback, useEffect, useState } from 'react';
import type { CarouselCurrent, MeResponse } from '../shared/types';
import { api, errorMessage } from './api';
import { TaskForm } from './components/TaskForm';
import { Toast, type ToastAction, type ToastData } from './components/Toast';
import { useOnline } from './hooks/useOnline';
import { CarouselScreen } from './screens/CarouselScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { TasksScreen } from './screens/TasksScreen';

// Навигация без роутера: view-состояние в App (§4).

type View =
  | { name: 'carousel' }
  | { name: 'tasks'; tab: 'active' | 'completed' }
  | { name: 'history'; taskId: string; taskTitle: string };

export default function App() {
  const [view, setView] = useState<View>({ name: 'carousel' });
  const [me, setMe] = useState<MeResponse | null>(null);
  const [current, setCurrent] = useState<CarouselCurrent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const online = useOnline();

  const showToast = useCallback((message: string, action?: ToastAction) => {
    setToast({ id: Date.now(), message, action });
  }, []);

  const closeToast = useCallback(() => setToast(null), []);

  const loadInitial = useCallback(async () => {
    setLoadError(null);
    try {
      const [meResponse, carousel] = await Promise.all([api.me(), api.carouselCurrent()]);
      setMe(meResponse);
      setCurrent(carousel);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const refreshCurrent = useCallback(async () => {
    try {
      setCurrent(await api.carouselCurrent());
    } catch (err) {
      showToast(errorMessage(err));
    }
  }, [showToast]);

  // «Назад» из списка/истории: возвращаемся на карусель и обновляем её
  // (название/прогресс могли измениться на других экранах).
  const backToCarousel = useCallback(() => {
    setView({ name: 'carousel' });
    void refreshCurrent();
  }, [refreshCurrent]);

  // Создание (§4.3): задача уходит в конец карусели, текущая не переключается —
  // перезапрашиваем current только ради total/индикатора.
  const handleCreated = useCallback(() => {
    setCreateOpen(false);
    showToast('Задача добавлена');
    void refreshCurrent();
  }, [refreshCurrent, showToast]);

  if (loadError !== null) {
    return (
      <div className="app">
        {!online && (
          <div className="offline-banner" role="status">
            Нет подключения к интернету
          </div>
        )}
        <div className="empty-state">
          <p className="inline-error" role="alert">
            {loadError}
          </p>
          <button type="button" className="btn btn-primary" onClick={() => void loadInitial()}>
            Повторить
          </button>
        </div>
      </div>
    );
  }

  if (current === null) {
    return (
      <div className="app">
        <div className="splash">Загрузка…</div>
      </div>
    );
  }

  return (
    <div className="app">
      {!online && (
        <div className="offline-banner" role="status">
          Нет подключения к интернету
        </div>
      )}

      {view.name === 'carousel' && (
        <CarouselScreen
          current={current}
          email={me?.email ?? null}
          online={online}
          onCurrentChange={setCurrent}
          onOpenTasks={(tab) => setView({ name: 'tasks', tab })}
          onOpenHistory={(taskId, taskTitle) => setView({ name: 'history', taskId, taskTitle })}
          onOpenCreate={() => setCreateOpen(true)}
          onToast={showToast}
        />
      )}

      {view.name === 'tasks' && (
        <TasksScreen
          initialTab={view.tab}
          online={online}
          onBack={backToCarousel}
          onOpenInCarousel={(carousel) => {
            setCurrent(carousel);
            setView({ name: 'carousel' });
          }}
          onToast={showToast}
        />
      )}

      {view.name === 'history' && (
        <HistoryScreen taskId={view.taskId} taskTitle={view.taskTitle} onBack={backToCarousel} />
      )}

      {createOpen && (
        <TaskForm
          mode="create"
          online={online}
          onClose={() => setCreateOpen(false)}
          onSaved={handleCreated}
        />
      )}

      {toast && <Toast toast={toast} onClose={closeToast} />}
    </div>
  );
}
