// Клиентская валидация формы задачи (§4.3, §12) по лимитам из общего контракта.

import { DESCRIPTION_MAX, TITLE_MAX } from '../../shared/types';

export interface TaskFieldErrors {
  title?: string;
  description?: string;
}

export function validateTaskFields(title: string, description: string): TaskFieldErrors {
  const errors: TaskFieldErrors = {};
  const trimmedTitle = title.trim();
  if (trimmedTitle === '') {
    errors.title = 'Введите название задачи';
  } else if (trimmedTitle.length > TITLE_MAX) {
    errors.title = `Название не длиннее ${TITLE_MAX} символов`;
  }
  if (description.length > DESCRIPTION_MAX) {
    errors.description = `Описание не длиннее ${DESCRIPTION_MAX} символов`;
  }
  return errors;
}
