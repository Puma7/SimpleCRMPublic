import path from 'path';
import {
  isSafeWorkflowPluginId,
  resolveWorkflowPluginModulePath,
} from '../../shared/workflow-plugin-path';

describe('workflow-plugin-path', () => {
  const root = '/tmp/simplecrm-plugins';

  test('rejects traversal in plugin id', () => {
    expect(isSafeWorkflowPluginId('../etc')).toBe(false);
    expect(
      resolveWorkflowPluginModulePath(root, '../node_modules', 'evil'),
    ).toBeNull();
  });

  test('resolves safe plugin path under root', () => {
    const p = resolveWorkflowPluginModulePath(root, 'my_plugin', 'handler');
    expect(p).toBe(path.resolve(root, 'my_plugin', 'handler.js'));
  });
});
