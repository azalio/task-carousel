// Локальные типы окружения Worker'а.
//
// Сгенерированный глобальный Env (worker-configuration.d.ts) не включает
// ASSETS-биндинг и объявляет DEV_AUTH_EMAIL как обязательную строку.
// Сгенерированный файл не редактируем — расширяем тип локально:
//  - ASSETS — Fetcher статических ассетов (см. wrangler.jsonc, секция assets);
//  - DEV_AUTH_EMAIL — задаётся только в .dev.vars, в production отсутствует.

export type WorkerBindings = Omit<Env, 'DEV_AUTH_EMAIL'> & {
  ASSETS: Fetcher;
  DEV_AUTH_EMAIL?: string;
};

// Параметры Hono-приложения: биндинги + переменные контекста запроса.
// userEmail заполняет auth-middleware — только из проверенного Access JWT.
export type AppEnv = {
  Bindings: WorkerBindings;
  Variables: {
    userEmail: string;
  };
};
