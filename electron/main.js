// Main Electron process
const { app, BrowserWindow, dialog, protocol, globalShortcut, screen } = require('electron'); // Added 'protocol'
const path = require('path');
const { pathToFileURL } = require('url');
const windowStateKeeper = require('electron-window-state');
const log = require('electron-log');
const { registerAllIpcHandlers } = require('../dist-electron/electron/ipc/router');
const {
  initializeAutoUpdater,
  checkForUpdatesAndNotify,
} = require('../dist-electron/electron/update-service');
const {
  allowedWindowOpenKind,
  isAllowedRendererNavigation,
} = require('../dist-electron/electron/security/navigation-policy');
const {
  buildRendererContentSecurityPolicy,
} = require('../dist-electron/electron/security/content-security-policy');
const {
  readElectronDeployConfig,
} = require('../dist-electron/electron/setup/deploy-config');

// Configure electron-log
log.transports.file.resolvePath = () => path.join(app.getPath('userData'), 'logs/main.log');
log.catchErrors(); // Catch unhandled errors
const disableConsoleTransportOnBrokenPipe = (stream) => {
  stream?.on?.('error', (error) => {
    if (error?.code === 'EPIPE') {
      log.transports.console.level = false;
    }
  });
};
disableConsoleTransportOnBrokenPipe(process.stdout);
disableConsoleTransportOnBrokenPipe(process.stderr);
const originalConsoleWriteFn = log.transports.console.writeFn;
log.transports.console.writeFn = (...args) => {
  try {
    return originalConsoleWriteFn(...args);
  } catch (error) {
    const isBrokenPipe =
      error?.code === 'EPIPE' ||
      error?.cause?.code === 'EPIPE' ||
      /EPIPE|broken pipe|errored state/i.test(String(error?.message));
    if (isBrokenPipe) {
      log.transports.console.level = false;
      return undefined;
    }
    throw error;
  }
};
Object.assign(console, log.functions); // Override console functions

const isDevelopment = process.env.NODE_ENV === 'development';

const clearProductionRendererCache = async (windowInstance) => {
  if (isDevelopment) {
    return;
  }

  const rendererSession = windowInstance?.webContents?.session;
  if (!rendererSession) {
    return;
  }

  try {
    await rendererSession.clearCache();
    if (typeof rendererSession.clearCodeCaches === 'function') {
      await rendererSession.clearCodeCaches({ urls: [] });
    }
    log.info('[Electron Main] Cleared production renderer cache before loading app:// content.');
  } catch (error) {
    log.warn('[Electron Main] Could not clear production renderer cache before loading app:// content:', error);
  }
};

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}

// Reduce log noise and protect secrets by defaulting to warn in production
log.transports.file.level = isDevelopment ? 'debug' : 'warn';
log.transports.file.maxSize = 5 * 1024 * 1024; // 5 MB rotation cap
log.transports.file.maxLogFiles = 3;

// Secret masking and port parsing moved into dedicated IPC modules.

const { initializeDatabase, closeDatabase } = require('../dist-electron/electron/sqlite-service');
const {
  startEmailBackgroundServices,
  stopEmailBackgroundServices,
} = require('../dist-electron/electron/email/email-imap-services');
const { initializeSyncService } = require('../dist-electron/electron/sync-service');
const {
  initializeMssqlService,
  closeMssqlPool,
} = require('../dist-electron/electron/mssql-keytar-service');
const {
  startAutomationApiServer,
  stopAutomationApiServer,
} = require('../dist-electron/electron/automation/server');

// Keep a global reference of the mainWindow object
let mainWindow;
let devToolsWindow = null;

// This will hold the function to load the content into the BrowserWindow
let loadURLFunction;

let cleanupIpcHandlers = () => {};
let rendererCspServerBaseUrl;
let rendererCspAllowsServerSelection = true;
const cspProtectedSessions = new WeakSet();

const rendererNavigationPolicy = () => ({
  isDevelopment,
  devServerUrl: process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173',
  productionFileUrl: pathToFileURL(path.join(__dirname, '../dist/index.html')).toString(),
});

const preventDisallowedNavigation = (webContents, policy) => {
  const guard = (event, url) => {
    if (isAllowedRendererNavigation(url, policy)) return;
    event.preventDefault();
    log.warn('[Electron Main] Blocked renderer navigation outside the application allowlist.');
  };
  webContents.on('will-navigate', guard);
  webContents.on('will-redirect', guard);
};

const installRendererContentSecurityPolicy = (webContents) => {
  const rendererSession = webContents?.session;
  if (!rendererSession || cspProtectedSessions.has(rendererSession)) return;
  cspProtectedSessions.add(rendererSession);
  rendererSession.webRequest.onHeadersReceived((details, callback) => {
    if (
      details.resourceType !== 'mainFrame'
      || !isAllowedRendererNavigation(details.url, rendererNavigationPolicy())
    ) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    const headers = { ...(details.responseHeaders || {}) };
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-security-policy') delete headers[key];
    }
    headers['Content-Security-Policy'] = [buildRendererContentSecurityPolicy({
      isDevelopment,
      devServerUrl: process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173',
      ...(rendererCspServerBaseUrl ? { serverBaseUrl: rendererCspServerBaseUrl } : {}),
      allowUnconfiguredServer: rendererCspAllowsServerSelection,
    })];
    callback({ responseHeaders: headers });
  });
};

const hardenChildWindow = (childWindow, initialUrl) => {
  const childContents = childWindow?.webContents;
  if (!childContents) return;
  const guard = (event, url) => {
    if (url === initialUrl) return;
    event.preventDefault();
    log.warn('[Electron Main] Blocked navigation from an isolated child window.');
  };
  childContents.on('will-navigate', guard);
  childContents.on('will-redirect', guard);
  childContents.setWindowOpenHandler(() => ({ action: 'deny' }));
};

const attachMainWindowSecurity = (webContents) => {
  installRendererContentSecurityPolicy(webContents);
  preventDisallowedNavigation(webContents, rendererNavigationPolicy());
  webContents.setWindowOpenHandler((details) => {
    const kind = allowedWindowOpenKind({
      url: details.url,
      frameName: details.frameName,
    });
    if (!kind) {
      log.warn('[Electron Main] Blocked popup outside the application allowlist.');
      return { action: 'deny' };
    }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          allowRunningInsecureContent: false,
          preload: undefined,
        },
      },
    };
  });
  webContents.on('did-create-window', (childWindow, details) => {
    hardenChildWindow(childWindow, details.url);
  });
};

const ensureDevToolsWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }
  if (devToolsWindow && !devToolsWindow.isDestroyed()) {
    return devToolsWindow;
  }

  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.min(1200, Math.max(900, Math.floor(workArea.width * 0.6)));
  const height = Math.min(900, Math.max(650, Math.floor(workArea.height * 0.75)));
  const x = workArea.x + Math.max(0, Math.floor((workArea.width - width) / 2));
  const y = workArea.y + Math.max(0, Math.floor((workArea.height - height) / 2));

  devToolsWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    title: 'SimpleCRM DevTools',
    autoHideMenuBar: false,
    show: false,
  });

  devToolsWindow.on('closed', () => {
    devToolsWindow = null;
  });

  mainWindow.webContents.setDevToolsWebContents(devToolsWindow.webContents);
  return devToolsWindow;
};

// Determine mode AT THE TOP
log.info(`\[Electron Main\] Initial check: process.env.NODE_ENV = ${process.env.NODE_ENV}, isDevelopment = ${isDevelopment}`);

// --- Setup loadURLFunction based on mode ---
// This setup, especially for electron-serve, needs to happen before 'app.ready'.
if (isDevelopment) {
  log.info('[Electron Main] Development mode: Setting up Vite dev server loader.');
  loadURLFunction = async (windowInstance) => {
    const viteDevServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    let targetUrl = viteDevServerUrl;
    try {
      const parsedUrl = new URL(viteDevServerUrl);
      // Router uses createHashHistory, so ensure we land on "#/" in dev too.
      if (!parsedUrl.hash) {
        parsedUrl.hash = '/';
      }
      targetUrl = parsedUrl.toString();
    } catch (error) {
      log.warn(`[Electron Main] Could not normalize Vite dev URL "${viteDevServerUrl}":`, error);
    }
    log.info(`\[Electron Main\] Development mode: Attempting to load URL: ${targetUrl}`);
    try {
      await windowInstance.loadURL(targetUrl);
      log.info('[Electron Main] Development URL loaded successfully.');
    } catch (error) {
      log.error(`\[Electron Main\] Failed to load Vite dev server URL ${targetUrl}:`, error);
      dialog.showErrorBox("Dev Server Load Error", `Could not connect to Vite dev server at ${targetUrl}. Please ensure it's running. Error: ${error.message}`);
    }
  };
} else {
  log.info('[Electron Main] Production mode: Setting up electron-serve loader before app ready.');
  try {
    const electronServeModule = require('electron-serve');
    const electronServeFunc = typeof electronServeModule === 'function'
      ? electronServeModule
      : (electronServeModule.default || null);

    if (typeof electronServeFunc === 'function') {
      const loadURL = electronServeFunc({ directory: path.join(__dirname, '../dist') });
      loadURLFunction = async (windowInstance) => {
        log.info('[Electron Main] Production mode: Loading with electron-serve');
        await clearProductionRendererCache(windowInstance);
        await loadURL(windowInstance);
        log.info('[Electron Main] Content loaded successfully with electron-serve');
      };
    } else {
      throw new Error('electron-serve did not provide a usable function');
    }
  } catch (error) {
    // Fallback to direct file loading if electron-serve setup fails.
    log.error('[Electron Main] electron-serve setup failed, falling back to loadFile:', error);
    loadURLFunction = async (windowInstance) => {
      const indexPath = path.join(__dirname, '../dist/index.html');
      log.info(`[Electron Main] Production mode: Loading file directly: ${indexPath}`);
      await clearProductionRendererCache(windowInstance);
      await windowInstance.loadFile(indexPath, { hash: '/' });
      log.info('[Electron Main] Content loaded successfully with loadFile');
    };
  }
}

// IPC handlers are registered via electron/ipc/router.ts once the app is ready.


// --- Main Application Initialization ---
async function initializeApp() {
  log.info('[Electron Main] initializeApp started.');
  // The electron-serve/Vite loader setup is now done above.
  // This function now only initializes other critical services.

  // Initialize other critical services
  try {
    log.info('[Electron Main] Initializing database and other services...');
    initializeDatabase();
    initializeMssqlService();
    initializeSyncService();
    log.info('[Electron Main] Database and other services initialized.');
  } catch (error) {
    log.error("[Electron Main] Failed to initialize core services:", error);
    throw error; // Propagate to stop app launch if services are critical
  }
  log.info('[Electron Main] initializeApp finished.');
}

// --- Create Main Window ---
async function createMainWindow() {
  log.info(`[Electron Main] createMainWindow called.`);
  try {
    const deployConfig = await readElectronDeployConfig(app.getPath('userData'));
    if (deployConfig.status === 'ok') {
      rendererCspServerBaseUrl = deployConfig.config.server?.baseUrl;
      rendererCspAllowsServerSelection = deployConfig.config.mode === 'server-install';
    } else {
      rendererCspServerBaseUrl = undefined;
      rendererCspAllowsServerSelection = true;
    }
  } catch (error) {
    rendererCspServerBaseUrl = undefined;
    rendererCspAllowsServerSelection = true;
    log.warn('[Electron Main] Could not resolve deploy config for renderer CSP:', error);
  }
  // Example structure:
  const windowState = windowStateKeeper({
    defaultWidth: 1400,
    defaultHeight: 1000,
  });

  const preloadPath = path.join(__dirname, 'electron/preload.js');
  const fs = require('fs');
  if (!fs.existsSync(preloadPath)) {
    log.error(`[Electron Main] CRITICAL: Preload script not found at: ${preloadPath}`);
  } else {
    log.info(`[Electron Main] Preload script found at: ${preloadPath}`);
  }

  mainWindow = new BrowserWindow({
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: preloadPath,
    },
    title: 'SimpleCRM',
    backgroundColor: '#FFFFFF',
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    autoHideMenuBar: true,
  });

  attachMainWindowSecurity(mainWindow.webContents);

  windowState.manage(mainWindow);

  const openDevToolsBar = () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    try {
      const toolsWindow = ensureDevToolsWindow();
      if (!mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.openDevTools({ activate: true });
        log.info('[Electron Main] DevTools opened.');
      } else {
        mainWindow.webContents.focusDevTools();
        log.info('[Electron Main] DevTools focused.');
      }
      if (toolsWindow && !toolsWindow.isDestroyed()) {
        if (toolsWindow.isMinimized()) {
          toolsWindow.restore();
        }
        toolsWindow.show();
        toolsWindow.focus();
      }
    } catch (error) {
      log.error('[Electron Main] Failed to open DevTools bar:', error);
    }
  };

  // Add preload error logging to diagnose preload script issues
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    log.info(`[Preload/Console] Level ${level}: ${message} (${sourceId}:${line})`);
  });

  // Catch preload errors specifically
  mainWindow.webContents.on('crashed', () => {
    log.error('[Preload/Renderer] Renderer process crashed');
  });

  mainWindow.webContents.on('unresponsive', () => {
    log.warn('[Preload/Renderer] Renderer process is unresponsive');
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    log.error(`[Electron Main] did-fail-load: code=${errorCode} description=${errorDescription} url=${validatedURL}`);
    openDevToolsBar();
  });

  mainWindow.webContents.on('devtools-opened', () => {
    log.info('[Electron Main] DevTools opened event.');
  });

  mainWindow.webContents.on('devtools-closed', () => {
    log.info('[Electron Main] DevTools closed event.');
  });

  const emitWindowState = () => {
    if (!mainWindow) {
      return;
    }
    if (mainWindow.webContents.isDestroyed()) {
      log.warn('[Electron Main] Skipping window state emit: webContents destroyed.');
      return;
    }
    const payload = {
      isMaximized: mainWindow.isMaximized(),
      isFullScreen: mainWindow.isFullScreen(),
    };
    log.debug(`[Electron Main] Emitting window state: ${JSON.stringify(payload)}`);
    mainWindow.webContents.send('window-state-changed', payload);
  };

  mainWindow.on('maximize', emitWindowState);
  mainWindow.on('unmaximize', emitWindowState);
  mainWindow.on('enter-full-screen', emitWindowState);
  mainWindow.on('leave-full-screen', emitWindowState);
  mainWindow.on('resized', () => {
    if (!mainWindow) {
      return;
    }
    // When leaving snapped states on Windows, resize fires before unmaximize.
    if (!mainWindow.isMaximized() && !mainWindow.isFullScreen()) {
      emitWindowState();
    }
  });

  mainWindow.webContents.once('did-finish-load', () => {
    log.debug('[Electron Main] Renderer finished loading, sending initial window state.');
    emitWindowState();
    if (isDevelopment) {
      openDevToolsBar();
    }
  });

  if (!loadURLFunction) {
    log.error('[Electron Main] ERROR in createMainWindow: loadURLFunction is not defined. Cannot load frontend.');
    dialog.showErrorBox("Application Load Error", "Frontend loader not configured. This usually means a critical error occurred during initial setup.");
    if (app && typeof app.isQuitting === 'function' && !app.isQuitting()) { app.quit(); } // Ensure app quits if critical error
    return;
  }

  try {
    log.info('[Electron Main] Attempting to load content into mainWindow...');
    await loadURLFunction(mainWindow);
    log.info('[Electron Main] Content loaded into mainWindow successfully.');
  } catch (error) {
    log.error('[Electron Main] Failed to load URL using loadURLFunction:', error);
    const errorMsg = `Failed to load application content. Error: ${error.message}\nURL: ${error.url || (isDevelopment ? 'http://localhost:5173' : 'app://- (electron-serve)') }`;
    dialog.showErrorBox("Application Load Error", errorMsg);
  }

  mainWindow.on('closed', () => {
    if (devToolsWindow && !devToolsWindow.isDestroyed()) {
      devToolsWindow.close();
    }
    devToolsWindow = null;
    mainWindow = null;
  });
}

// --- App Lifecycle ---
initializeApp()
  .then(() => {
    app.whenReady().then(async () => { // Added async here
      log.info('[Electron Main] App is ready (after initializeApp).');

      cleanupIpcHandlers = registerAllIpcHandlers({
        logger: log,
        isDevelopment,
        getMainWindow: () => mainWindow,
        appVersion: app.getVersion(),
      });

      if (!isDevelopment) {
        try {
          initializeAutoUpdater({
            logger: log,
            getMainWindow: () => mainWindow,
          });

          // Perform a background update check without blocking window creation
          checkForUpdatesAndNotify().catch((error) => {
            log.error('[Electron Main] Auto-update check failed:', error);
          });
        } catch (error) {
          log.error('[Electron Main] Failed to initialize auto-updater:', error);
        }
      }

      await createMainWindow(); // Create the main window

      startEmailBackgroundServices(log).catch((err) => log.warn('[email] background services', err));

      startAutomationApiServer(log).catch((err) => log.warn('[automation-api] start failed', err));

      const toggleDevTools = () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          return;
        }
        if (mainWindow.webContents.isDevToolsOpened()) {
          mainWindow.webContents.closeDevTools();
        } else {
          ensureDevToolsWindow();
          mainWindow.webContents.openDevTools({ activate: true });
        }
      };

      const f12Registered = globalShortcut.register('F12', toggleDevTools);
      const chordRegistered = globalShortcut.register('CommandOrControl+Shift+I', toggleDevTools);
      log.info(`[Electron Main] Registered F12 DevTools shortcut: ${f12Registered}`);
      log.info(`[Electron Main] Registered Cmd/Ctrl+Shift+I DevTools shortcut: ${chordRegistered}`);

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createMainWindow();
        }
      });
    }).catch(err => {
      log.error('[Electron Main] Error during app.whenReady:', err);
      // Optionally, show a dialog to the user or quit the app
      dialog.showErrorBox("Application Startup Error", `A critical error occurred during application startup: ${err.message}. The application will now close.`);
      app.quit();
    });
  })
  .catch(err => {
    log.error('[Electron Main] Error during initializeApp:', err);
    // This is a critical failure, show error and quit
    // Note: app might not be ready here, so dialog might not work as expected
    // but it's worth a try.
    if (app && typeof dialog.showErrorBox === 'function') {
      dialog.showErrorBox("Application Initialization Error", `A critical error occurred during application initialization: ${err.message}. The application will now close.`);
    }
    // Ensure the app quits if initialization fails critically
    if (app && typeof app.quit === 'function') {
      app.quit();
    } else {
      process.exit(1); // Force exit if app object is not available
    }
  });

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    try {
      stopEmailBackgroundServices();
    } catch (e) {
      log.warn('[email] stop background on window-all-closed', e);
    }
    closeDatabase();
    if (typeof closeMssqlPool === 'function') {
      closeMssqlPool().catch(err => log.error('Error closing MSSQL pool:', err));
    }
    log.info('[Electron Main] All windows closed, quitting application.');
    app.quit();
  }
});

// Handle app quit explicitly to ensure resources are released
app.on('will-quit', () => {
  // This is a good place for final cleanup if needed,
  // though window-all-closed might cover most cases for non-macOS.
  log.info('[Electron Main] Application will quit.');
  try {
    stopEmailBackgroundServices();
  } catch (e) {
    log.warn('[email] stop background', e);
  }
  stopAutomationApiServer().catch((err) => log.warn('[automation-api] stop failed', err));
  globalShortcut.unregisterAll();
  if (typeof cleanupIpcHandlers === 'function') {
    try {
      cleanupIpcHandlers();
    } catch (error) {
      log.error('Error during IPC cleanup:', error);
    }
  }
  // Ensure database is closed on quit as well, especially for macOS or if app quits unexpectedly
  closeDatabase();
  if (typeof closeMssqlPool === 'function') {
    closeMssqlPool().catch(err => log.error('Error closing MSSQL pool on will-quit:', err));
  }
});
