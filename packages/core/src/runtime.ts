import type { CorePlatformPorts, SimpleCrmDeployMode } from './platform';

export type CoreRuntimeOptions = {
  mode: SimpleCrmDeployMode;
  workspaceId: string;
  ports: CorePlatformPorts;
};

export type CoreRuntime = Readonly<{
  mode: SimpleCrmDeployMode;
  workspaceId: string;
  ports: CorePlatformPorts;
}>;

export function createCoreRuntime(options: CoreRuntimeOptions): CoreRuntime {
  if (!options.workspaceId.trim()) {
    throw new Error('workspaceId is required');
  }

  return Object.freeze({
    mode: options.mode,
    workspaceId: options.workspaceId,
    ports: options.ports,
  });
}
