#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectNativeRuntime } from './native-runtime-manager.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptName = process.argv[2];

if (!scriptName || !/^[a-z0-9:.-]+$/i.test(scriptName)) {
  console.error('Usage: node scripts/run-with-electron-native.mjs <npm-script>');
  process.exitCode = 1;
} else {
  let child;
  let forwardedSignal;
  const forwardSignal = (signal) => {
    forwardedSignal = signal;
    if (child && !child.killed) {
      try {
        child.kill(signal);
      } catch {
        child.kill();
      }
    }
  };

  process.on('SIGINT', forwardSignal);
  process.on('SIGTERM', forwardSignal);

  let childExitCode = 1;
  try {
    await selectNativeRuntime('electron');
    const npmCommand = process.platform === 'win32'
      ? (process.env.ComSpec || 'cmd.exe')
      : 'npm';
    const npmArgs = process.platform === 'win32'
      ? ['/d', '/s', '/c', `npm.cmd run ${scriptName}`]
      : ['run', scriptName];
    child = spawn(npmCommand, npmArgs, {
      cwd: workspaceRoot,
      env: process.env,
      stdio: 'inherit',
      windowsHide: false,
    });
    childExitCode = await new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (signal) forwardedSignal = signal;
        resolveExit(code ?? 1);
      });
    });
  } catch (error) {
    console.error(error instanceof Error ? error.stack : error);
    childExitCode = 1;
  } finally {
    process.off('SIGINT', forwardSignal);
    process.off('SIGTERM', forwardSignal);
    try {
      await selectNativeRuntime('node');
    } catch (error) {
      console.error('Failed to restore Node native modules:', error);
      childExitCode = 1;
    }
  }

  process.exitCode = forwardedSignal === 'SIGINT'
    ? 130
    : forwardedSignal === 'SIGTERM'
      ? 143
      : childExitCode;
}
