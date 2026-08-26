import { AsyncLocalStorage } from 'node:async_hooks';

// Per-request store, populated by the ALS middleware in main.ts. AppLogger reads
// the requestId from here so every log line during a request shares one id.
export const requestContext = new AsyncLocalStorage<{ requestId: string }>();
