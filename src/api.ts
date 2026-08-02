// API-клиент поверх fetch. Контракт — shared/types.ts (§11 ТЗ).
// При !ok парсит ApiErrorBody и кидает типизированную ApiError.

import type {
  ApiErrorBody,
  ApiErrorCode,
  CarouselCurrent,
  CheckInBody,
  CheckInResponse,
  CompleteResponse,
  CreateTaskBody,
  MeResponse,
  MoveBody,
  ProgressEntry,
  ReopenResponse,
  SelectBody,
  Task,
  TaskListItem,
  UpdateTaskBody,
} from '../shared/types';

export const AUTH_REQUIRED_EVENT = 'task-carousel:auth-required';
export const AUTH_REQUIRED_MESSAGE = 'Войдите снова, чтобы продолжить работу.';

type ClientErrorCode = ApiErrorCode | 'NETWORK_ERROR' | 'AUTH_REQUIRED';

export class ApiError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;

  constructor(code: ClientErrorCode, status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Не удалось выполнить действие. Проверьте подключение и повторите.';
}

export function isAuthRequiredError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === 'AUTH_REQUIRED';
}

function authRequiredError(): ApiError {
  const error = new ApiError('AUTH_REQUIRED', 0, AUTH_REQUIRED_MESSAGE);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
  }
  return error;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const init: RequestInit = {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    // Cloudflare Access отвечает редиректом при истёкшей сессии. В manual-режиме
    // браузер возвращает opaqueredirect, который можно отличить от обрыва сети.
    redirect: 'manual',
  };
  if (options.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError('NETWORK_ERROR', 0, 'Нет подключения к интернету');
  }

  if (response.type === 'opaqueredirect') {
    throw authRequiredError();
  }

  if (!response.ok) {
    let code: ApiErrorCode = 'INTERNAL_ERROR';
    let message = `Ошибка запроса (${response.status})`;
    try {
      const body = (await response.json()) as ApiErrorBody;
      if (typeof body?.error?.message === 'string' && body.error.message !== '') {
        message = body.error.message;
        code = body.error.code;
      }
    } catch {
      // тело не JSON — оставляем общее сообщение
    }
    throw new ApiError(code, response.status, message);
  }

  return (await response.json()) as T;
}

export const api = {
  me: (): Promise<MeResponse> => request<MeResponse>('/api/me'),

  tasks: (status: 'active' | 'completed' | 'all'): Promise<TaskListItem[]> =>
    request<TaskListItem[]>(`/api/tasks?status=${status}`),

  createTask: (body: CreateTaskBody): Promise<Task> =>
    request<Task>('/api/tasks', { method: 'POST', body }),

  updateTask: (taskId: string, body: UpdateTaskBody): Promise<Task> =>
    request<Task>(`/api/tasks/${taskId}`, { method: 'PATCH', body }),

  carouselCurrent: (): Promise<CarouselCurrent> =>
    request<CarouselCurrent>('/api/carousel/current'),

  carouselMove: (direction: MoveBody['direction']): Promise<CarouselCurrent> =>
    request<CarouselCurrent>('/api/carousel/move', {
      method: 'POST',
      body: { direction } satisfies MoveBody,
    }),

  carouselSelect: (taskId: string): Promise<CarouselCurrent> =>
    request<CarouselCurrent>('/api/carousel/select', {
      method: 'POST',
      body: { taskId } satisfies SelectBody,
    }),

  checkIn: (taskId: string, note: string): Promise<CheckInResponse> =>
    request<CheckInResponse>(`/api/tasks/${taskId}/check-in`, {
      method: 'POST',
      body: { note } satisfies CheckInBody,
    }),

  completeTask: (taskId: string): Promise<CompleteResponse> =>
    request<CompleteResponse>(`/api/tasks/${taskId}/complete`, { method: 'POST' }),

  reopenTask: (taskId: string): Promise<ReopenResponse> =>
    request<ReopenResponse>(`/api/tasks/${taskId}/reopen`, { method: 'POST' }),

  progress: (taskId: string): Promise<ProgressEntry[]> =>
    request<ProgressEntry[]>(`/api/tasks/${taskId}/progress`),
};
