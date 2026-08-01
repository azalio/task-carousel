import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { TITLE_MAX, type Task } from '../../shared/types';
import { api, errorMessage } from '../api';
import { validateTaskFields } from '../lib/validate';

// Форма создания/редактирования задачи (§4.3–4.4).
// На мобильном — bottom sheet, на desktop — модальный диалог (CSS media query).

interface TaskFormProps {
  mode: 'create' | 'edit';
  initial?: { id: string; title: string; description: string };
  online: boolean;
  onClose: () => void;
  onSaved: (task: Task) => void;
}

export function TaskForm({ mode, initial, online, onClose, onSaved }: TaskFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    titleRef.current?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  const errors = validateTaskFields(title, description);
  // Ошибки длины показываем сразу, «обязательное поле» — после попытки отправки.
  const showTitleError =
    errors.title !== undefined && (submitted || title.trim().length > TITLE_MAX);
  const showDescriptionError = errors.description !== undefined;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (errors.title !== undefined) {
      titleRef.current?.focus();
      return;
    }
    if (errors.description !== undefined) {
      descriptionRef.current?.focus();
      return;
    }
    if (pending || !online) return;
    if (mode === 'edit' && !initial) return;

    setPending(true);
    setSubmitError(null);
    const body = { title: title.trim(), description: description.trim() };
    try {
      let task: Task;
      if (mode === 'edit') {
        if (!initial) return;
        task = await api.updateTask(initial.id, body);
      } else {
        task = await api.createTask(body);
      }
      onSaved(task);
    } catch (error) {
      setSubmitError(errorMessage(error));
      setPending(false);
    }
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.getClientRects().length > 0);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="modal-overlay"
      aria-modal="true"
      aria-labelledby="task-form-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={handleDialogKeyDown}
    >
      <div className="modal">
        <h2 id="task-form-title" className="modal-title">
          {mode === 'create' ? 'Новая задача' : 'Редактировать задачу'}
        </h2>
        <form onSubmit={(event) => void handleSubmit(event)} noValidate>
          <div className="field">
            <label className="field-label" htmlFor="task-title-input">
              Название
            </label>
            <input
              id="task-title-input"
              ref={titleRef}
              type="text"
              className={showTitleError ? 'field-input input-invalid' : 'field-input'}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-invalid={showTitleError ? true : undefined}
              aria-describedby={showTitleError ? 'task-title-error' : undefined}
            />
            {showTitleError && (
              <span id="task-title-error" className="field-error">
                {errors.title}
              </span>
            )}
          </div>
          <div className="field">
            <label className="field-label" htmlFor="task-description-input">
              Описание
            </label>
            <textarea
              id="task-description-input"
              ref={descriptionRef}
              rows={4}
              className={showDescriptionError ? 'field-input input-invalid' : 'field-input'}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              aria-invalid={showDescriptionError ? true : undefined}
              aria-describedby={showDescriptionError ? 'task-description-error' : undefined}
            />
            {showDescriptionError && (
              <span id="task-description-error" className="field-error">
                {errors.description}
              </span>
            )}
          </div>
          {submitError !== null && (
            <p className="inline-error" role="alert">
              {submitError}
            </p>
          )}
          {!online && <p className="inline-error">Нет подключения к интернету</p>}
          <div className="btn-row form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending || !online}>
              {pending ? 'Сохраняю…' : mode === 'create' ? 'Добавить' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </dialog>
  );
}
