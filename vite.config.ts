import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // A DST-observing zone, so the date tests exercise clock changes instead of silently passing under UTC in CI.
    env: { TZ: 'America/Denver' },
  },
});
