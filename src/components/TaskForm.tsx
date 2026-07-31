import { useEffect, useRef, useState, type FormEvent } from 'react';
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
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const errors = validateTaskFields(title, description);
  // Ошибки длины показываем сразу, «обязательное поле» — после попытки отправки.
  const showTitleError =
    errors.title !== undefined && (submitted || title.trim().length > TITLE_MAX);
  const showDescriptionError = errors.description !== undefined;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    if (errors.title !== undefined || errors.description !== undefined) return;
    if (pending || !online) return;

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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-form-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="task-form-title" className="modal-title">
          {mode === 'create' ? 'Новая задача' : 'Редактировать задачу'}
        </h2>
        <form onSubmit={(event) => void handleSubmit(event)} noValidate>
          <label className="field">
            <span className="field-label">Название</span>
            <input
              ref={titleRef}
              type="text"
              className={showTitleError ? 'field-input input-invalid' : 'field-input'}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              aria-invalid={showTitleError}
            />
            {showTitleError && (
              <span className="field-error" role="alert">
                {errors.title}
              </span>
            )}
          </label>
          <label className="field">
            <span className="field-label">Описание</span>
            <textarea
              rows={4}
              className={showDescriptionError ? 'field-input input-invalid' : 'field-input'}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              aria-invalid={showDescriptionError}
            />
            {showDescriptionError && (
              <span className="field-error" role="alert">
                {errors.description}
              </span>
            )}
          </label>
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
    </div>
  );
}
