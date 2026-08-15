import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      thresholds: {
        lines: 85,
        functions: 85,
        statements: 85,
        branches: 75,
      },
    },
  },
});
