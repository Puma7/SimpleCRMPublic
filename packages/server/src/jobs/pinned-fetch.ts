// The pinned transport lives in @simplecrm/core so the desktop workflow HTTP node
// uses the same DNS-pinned, byte-capped connection as the server edition.
export {
  createPinnedFetch,
  type GuardedFetch,
  type GuardedHttpInit,
  type GuardedHttpResponse,
} from '@simplecrm/core';
