const nextJest = require('next/jest')

const createJestConfig = nextJest({
  dir: './',
})

const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  testPathIgnorePatterns: ['<rootDir>/e2e/', '<rootDir>/node_modules/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@/rag/(.*)$': '<rootDir>/rag/$1',
    '^@/observability/(.*)$': '<rootDir>/observability/$1',
    '^@/db/(.*)$': '<rootDir>/db/$1',
    '^@/eval/(.*)$': '<rootDir>/eval/$1',
    '^@/tests/(.*)$': '<rootDir>/tests/$1',
  },
}

module.exports = createJestConfig(customJestConfig)
