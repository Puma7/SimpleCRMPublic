# SimpleCRM

SimpleCRM is a desktop-based Customer Relationship Management (CRM) application built with Electron, React, and TypeScript. It bundles essential CRM features on your local machine, helping you manage customers, products, deals, tasks, and your schedule. It also offers optional one-way data synchronization from your JTL MSSQL database.

## Features

* **Customer Management:** Create, Read, Update, and Delete customer records.
* **Product Management:** Keep track of your local product inventory and details.
* **Deal Tracking:** Create, manage, and visualize your sales deals. Link products and monitor stages from lead to win.
* **Task Management:** Create and manage tasks linked directly to customers.
* **Calendar Integration:** Schedule appointments, meetings, and reminders within the app.
* **JTL Synchronization (Optional):** Sync Customer and Product data from an external JTL MSSQL database into your local CRM (one-way sync).
* **E-Mail (IMAP, Desktop):** Under **E-Mail** in the navigation you can add IMAP accounts (password stored in the OS keychain), sync the INBOX, and read messages. The first sync loads the **newest messages only** (up to a capped count), not the entire mailbox history; further syncs fetch by UID range. SMTP, workflows, and AI features are planned extensions.
* **Local Database:** All your CRM data is stored securely and locally using SQLite (`better-sqlite3`).
* **Secure Configuration:** MSSQL connection details are stored securely using your OS keychain via Keytar (`keytar`).

## How it Works

SimpleCRM leverages the Electron framework to deliver a web-powered experience on your desktop:

1. **Main Process (`electron/main.js`):** Handles window management, background logic, database interactions (SQLite & MSSQL), and inter-process communication (IPC). Manages essential services including `sqlite-service`, `mssql-keytar-service`, and `sync-service`.
2. **Renderer Process (`src/`):** The user interface built with React and Vite. Communicates with the Main process using secure IPC calls (defined in `electron/preload.ts`) to fetch and update data.
3. **Database (`electron/sqlite-service.ts`, `electron/database-schema.ts`):** Manages the SQLite database (`database.sqlite` in your app data folder), defining the schema and handling all data operations (Create, Read, Update, Delete).
4. **MSSQL & Sync (`electron/mssql-keytar-service.ts`, `electron/sync-service.ts`):** Connects securely to your JTL MSSQL database, fetches customer and product data, and updates your local SQLite database.
5. **UI Components (`src/components/`):** Built with Shadcn/ui library for a consistent and customizable user interface.

## Tech Stack

* **Framework:** Electron, React
* **Language:** TypeScript
* **UI:** Shadcn/ui, Tailwind CSS
* **Routing:** TanStack Router
* **Local Database:** SQLite (via `better-sqlite3`)
* **External DB Connection:** `mssql` package
* **Secure Storage:** `keytar`
* **Build Tool:** Vite
* **Bundler/Packager:** Electron Builder

## Setup & Installation

1. **Clone the Repository:**
   ```bash
   git clone <your-repository-url>
   cd simplecrmelectron
   ```
2. **Install Dependencies:**
   ```bash
   npm install --legacy-peer-deps
   ```
   (`--legacy-peer-deps` avoids peer-resolution conflicts in the current dependency tree.)
3. **Rebuild Native Modules:**
   Electron apps sometimes need native modules rebuilt for your specific setup. The `postinstall` script should handle this, but if you encounter issues, run:
   ```bash
   npm run postinstall
   # or force it with:
   npx electron-rebuild -f -w better-sqlite3,keytar
   ```

## Running the Application

* **Development Mode:**
  Starts the Vite dev server for instant UI updates and the Electron app.
  The `electron:dev` script compiles main-process TypeScript in watch mode so IPC handlers (including E-Mail) stay in sync with `dist-electron`.
  ```bash
  npm run electron:dev
  ```
* **Production Mode:**
  Runs the app as it would be packaged. Build the renderer with `npm run build:web`, compile the Electron main-process TypeScript with `npm run build:electron:main`, or run `npm run build` to do both.
  ```bash
  npm run electron:start
  ```

## Building the Application

To create an installer (`.exe`, `.dmg`, etc.):

1. **Build the Frontend & Electron Code:**
   ```bash
   npm run build
   ```
   This runs `build:web` (renderer) and `build:electron:main` (compiled IPC/services under `dist-electron/electron/`). The Vite Electron bundle step is included in `npm run build` via `vite build`.
2. **Package with Electron Builder:**
   ```bash
   npm run electron:build
   ```
   The installer will be created in the `dist-build` directory.

## Configuration

* **MSSQL Connection:** Configure the connection to your JTL MSSQL database in the **Settings** page within the app. Your password is stored securely in your operating system's keychain.
