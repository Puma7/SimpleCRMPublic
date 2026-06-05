export type DesktopDeployMode = 'standalone' | 'server-client';

export const DESKTOP_PACKAGE_ROLE = 'Electron wrapper for standalone and thin-client modes';

export * from './deploy-config';
export * from './embedded-postgres';
export * from './electron-standalone';
export * from './migrate-to-server';
