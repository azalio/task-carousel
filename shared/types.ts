// Общий контракт API между Worker (worker/) и frontend (src/).
// Источник требований: docs/design.md §11. Все времена — Unix ms.

export type TaskStatus = 'active' | 'completed';

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 5000;
export const NOTE_MAX = 5000;

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  position: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

// Элемент списка задач (экран «Все задачи», §4.2):
// activе — дата последнего прогресса + число записей; completed — дата завершения.
export interface TaskListItem extends Task {
  progressCount: number;
  lastProgressAt: number | null;
}

export interface ProgressEntry {
  id: string;
  taskId: string;
  note: string;
  createdAt: number;
}

export interface LastProgress {
  note: string;
  createdAt: number;
}

// Текущая задача карусели (GET /api/carousel/current, §11).
export interface CarouselTask {
  id: string;
  title: string;
  description: string;
  lastProgress: LastProgress | null;
}

export interface CarouselCurrent {
  task: CarouselTask | null; // null — нет активных задач
  previousTask: CarouselTask | null; // сосед слева; null при 0–1 активной задаче
  nextTask: CarouselTask | null; // сосед справа; null при 0–1 активной задаче
  currentIndex: number; // с нуля; 0 при отсутствии задач
  total: number; // число активных задач
}

// ---- Тела запросов ----

export interface CreateTaskBody {
  title: string;
  description?: string;
}

export interface UpdateTaskBody {
  title?: string;
  description?: string;
}

export interface MoveBody {
  direction: 'next' | 'previous';
}

// Расширение сверх §11: открыть конкретную задачу из списка («Открыть», §4.2).
export interface SelectBody {
  taskId: string;
}

export interface CheckInBody {
  note: string;
}

// ---- Ответы ----

export interface MeResponse {
  email: string;
}

export interface CheckInResponse {
  entry: ProgressEntry;
  current: CarouselCurrent;
}

export interface CompleteResponse {
  task: Task; // завершённая задача
  current: CarouselCurrent; // следующая текущая (task: null, если активных не осталось)
}

export interface ReopenResponse {
  task: Task; // возвращённая в работу (в конец карусели)
  current: CarouselCurrent;
}

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'INVALID_TOKEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL_ERROR';

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
  };
}

// Маршруты API (все под /api, email пользователя — только из Access JWT):
//   GET    /api/me                      -> MeResponse
//   GET    /api/tasks?status=active|completed|all -> TaskListItem[]
//   POST   /api/tasks                   (CreateTaskBody)  -> 201 Task
//   PATCH  /api/tasks/:taskId           (UpdateTaskBody)  -> Task
//   GET    /api/carousel/current        -> CarouselCurrent
//   POST   /api/carousel/move           (MoveBody)        -> CarouselCurrent
//   POST   /api/carousel/select         (SelectBody)      -> CarouselCurrent
//   POST   /api/tasks/:taskId/check-in  (CheckInBody)     -> 201 CheckInResponse
//   POST   /api/tasks/:taskId/complete  -> CompleteResponse
//   POST   /api/tasks/:taskId/reopen    -> ReopenResponse
//   GET    /api/tasks/:taskId/progress  -> ProgressEntry[] (новые сверху)
