import { defineConfig } from 'vitest/config';

// Чистые unit-тесты (worker/carousel.ts, worker/validation.ts, src/lib/*) — node env.
export default defineConfig({
  test: {
    name: 'unit',
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
