/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@ip-centrum/shared$': '<rootDir>/packages/shared/src/index.ts',
    '^@ip-centrum/database$': '<rootDir>/packages/database/src/index.ts',
    '^@ip-centrum/event-bus$': '<rootDir>/packages/event-bus/src/index.ts',
    '^@ip-centrum/agent-orchestrator$': '<rootDir>/packages/agents/orchestrator/src/index.ts',
    '^@ip-centrum/agent-doc-intel$': '<rootDir>/packages/agents/doc-intel/src/index.ts',
    '^@ip-centrum/agent-case-health$': '<rootDir>/packages/agents/case-health/src/index.ts',
    '^@ip-centrum/agent-data-verify$': '<rootDir>/packages/agents/data-verify/src/index.ts',
    '^@ip-centrum/agent-trans-orch$': '<rootDir>/packages/agents/trans-orch/src/index.ts',
    '^@ip-centrum/agent-agent-net$': '<rootDir>/packages/agents/agent-net/src/index.ts',
    '^@ip-centrum/agent-client-comms$': '<rootDir>/packages/agents/client-comms/src/index.ts',
    '^@ip-centrum/agent-quote-advisor$': '<rootDir>/packages/agents/quote-advisor/src/index.ts',
    '^@ip-centrum/agent-renew-intel$': '<rootDir>/packages/agents/renew-intel/src/index.ts',
    '^@ip-centrum/agent-reg-watch$': '<rootDir>/packages/agents/reg-watch/src/index.ts',
    '^@ip-centrum/agent-biz-signal$': '<rootDir>/packages/agents/biz-signal/src/index.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  collectCoverageFrom: [
    'packages/**/*.ts',
    'apps/**/*.ts',
    '!**/*.d.ts',
    '!**/dist/**',
    '!**/node_modules/**',
  ],
  coverageThreshold: {
    global: { branches: 60, functions: 70, lines: 70, statements: 70 },
  },
  testTimeout: 30000,
};
