import '@testing-library/jest-dom';
import { TextDecoder, TextEncoder } from 'node:util';
import { deserialize, serialize } from 'node:v8';

Object.assign(globalThis, { TextDecoder, TextEncoder });

// jsdom's sandbox lacks structuredClone (needed by @dagrejs/dagre).
if (typeof globalThis.structuredClone !== 'function') {
  Object.assign(globalThis, {
    structuredClone: <T>(value: T): T => deserialize(serialize(value)) as T,
  });
}

beforeEach(() => {
  jest.restoreAllMocks();
  // Plan 044: Zugangsdaten-Speicher der Tests (tests/setup/credential-runtime-mock.ts) leeren.
  (globalThis as { __simplecrmCredentialRows?: Map<string, unknown> }).__simplecrmCredentialRows?.clear();
});
