import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';

// Интеграционные тесты Worker API в workerd с реальной (miniflare) D1.
export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    test: {
      name: 'workers',
      include: ['tests/worker/**/*.test.ts'],
      setupFiles: ['./tests/worker/apply-migrations.ts'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.jsonc' },
          miniflare: {
            bindings: {
              TEST_MIGRATIONS: migrations,
              // Тесты ходят в API от имени этого пользователя (auth-bypass как в dev).
              DEV_AUTH_EMAIL: 'test@example.com',
            },
          },
        },
      },
    },
  };
});
