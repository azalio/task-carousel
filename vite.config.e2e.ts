import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

// Конфиг Vite ТОЛЬКО для e2e-прогонов (playwright.config.ts).
// Отличие от vite.config.ts: состояние miniflare (D1) живёт в отдельном
// каталоге .wrangler/e2e-state, который e2e/global-setup.ts пересоздаёт перед
// каждым прогоном (rm -rf + wrangler d1 migrations apply --persist-to) —
// каждый прогон e2e стартует с чистой базой и не трогает dev-состояние
// в .wrangler/state.
export default defineConfig({
  plugins: [react(), cloudflare({ persistState: { path: '.wrangler/e2e-state' } })],
});
