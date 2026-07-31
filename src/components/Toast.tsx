import { useEffect } from 'react';

// Toast с автоскрытием через 5 секунд и опциональным действием («Отменить», §6).

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
  useEffect(() => {
    const timer = window.setTimeout(onClose, TOAST_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [toast.id, onClose]);

  return (
    <div className="toast" role="status">
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
    </div>
  );
}
