import type { SimpleCrmDeployMode } from './platform';

export const SERVER_EDITION_TARGETS = Object.freeze({
  nodeMajor: 22,
  postgresMajor: 18,
  electronMajor: 41,
  defaultApiPort: 3000,
});

export const SERVER_EDITION_DEPLOY_MODES: readonly SimpleCrmDeployMode[] = [
  'standalone',
  'headless',
  'server',
];

export function isServerEditionDeployMode(value: string): value is SimpleCrmDeployMode {
  return SERVER_EDITION_DEPLOY_MODES.includes(value as SimpleCrmDeployMode);
}
