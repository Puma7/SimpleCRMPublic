import http from 'http';
import type { Server } from 'http';
import { handleAutomationRequest } from './handlers';
import { getAutomationBindHost, getAutomationPort, isAutomationApiEnabled } from './settings';

let server: Server | null = null;

export function isAutomationServerRunning(): boolean {
  return server != null && server.listening;
}

export async function startAutomationApiServer(logger: Pick<typeof console, 'info' | 'warn' | 'error'>): Promise<void> {
  await stopAutomationApiServer();

  if (!isAutomationApiEnabled()) {
    logger.info('[automation-api] disabled — not starting server');
    return;
  }

  const host = getAutomationBindHost();
  const port = getAutomationPort();

  server = http.createServer((req, res) => {
    void handleAutomationRequest(req, res).catch((err) => {
      logger.error('[automation-api] unhandled', err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'internal_error', message: 'Interner Fehler' } }));
      }
    });
  });

  server.on('clientError', (_err, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        server = null;
        reject(err);
      };
      server!.once('error', onError);
      server!.listen(port, host, () => {
        server!.off('error', onError);
        logger.info(`[automation-api] listening on http://${host}:${port}/api/v1`);
        if (host === '0.0.0.0') {
          logger.warn('[automation-api] LAN bind active — ensure firewall rules restrict access');
        }
        resolve();
      });
    });
  } catch (err) {
    server = null;
    const code = err && typeof err === 'object' && 'code' in err ? String((err as NodeJS.ErrnoException).code) : '';
    if (code === 'EADDRINUSE') {
      logger.warn(`[automation-api] port ${port} already in use — API not started`);
      return;
    }
    throw err;
  }
}

export async function stopAutomationApiServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => {
    server!.close(() => resolve());
  });
  server = null;
}

export async function restartAutomationApiServer(
  logger: Pick<typeof console, 'info' | 'warn' | 'error'>,
): Promise<void> {
  await startAutomationApiServer(logger);
}
