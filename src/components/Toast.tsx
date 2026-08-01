import { useEffect, useRef, useState } from 'react';

// Toast с пятисекундным таймером (§6). Таймер останавливается, пока пользователь
// держит указатель над уведомлением или работает с его кнопками с клавиатуры.

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastData {
  id: number;
  message: string;
  action?: ToastAction;
}

const TOAST_TIMEOUT_MS = 5000;

interface ToastProps {
  toast: ToastData;
  onClose: () => void;
}

export function Toast({ toast, onClose }: ToastProps) {
  const [paused, setPaused] = useState(false);
  const remainingMs = useRef(TOAST_TIMEOUT_MS);

  useEffect(() => {
    if (paused) return;
    const startedAt = performance.now();
    const timer = window.setTimeout(onClose, remainingMs.current);
    return () => {
      window.clearTimeout(timer);
      remainingMs.current = Math.max(
        0,
        remainingMs.current - (performance.now() - startedAt),
      );
    };
  }, [paused, onClose]);

  return (
    <div
      className="toast"
      role="status"
      aria-atomic="true"
      onMouseMove={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setPaused(false);
        }
      }}
    >
      <span className="toast-message">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.action?.run();
            onClose();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        className="toast-close"
        aria-label="Закрыть уведомление"
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}
