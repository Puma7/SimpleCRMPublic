# Svelte Lab (Beta)

Isoliertes **Svelte 5 + Svelte Flow** (`@xyflow/svelte`) zum Testen — **ohne** Svelte im React-Bundle der Haupt-App.

## Beziehung zu React Flow

| App | Paket | Version (Stand) |
|-----|--------|------------------|
| Produktion (Workflow-Editor) | `@xyflow/react` | **12.x** (`^12.10.1` im Root-`package.json`) |
| Dieses Lab | `@xyflow/svelte` | **1.x** (Svelte Flow, gemeinsamer `@xyflow/system`-Kern) |

Es gibt **kein** „React Flow 12 als Svelte-Paket“ — parallel heißt: gleiche xyflow-Familie, getrennte Renderer.

## Start

```bash
cd packages/svelte-lab
npm install
npm run dev
```

→ http://127.0.0.1:5174

## In SimpleCRM einbetten (optional)

1. Root `.env` (oder `.env.local`):

   ```
   VITE_ENABLE_SVELTE_LAB=true
   VITE_SVELTE_LAB_URL=http://127.0.0.1:5174
   ```

2. Zwei Terminals:

   - `npm run svelte-lab:dev`
   - `npm run electron:dev`

3. In der App: **E-Mail → Svelte Lab (Beta)**

Die React-App lädt nur ein **iframe** — kein Svelte-Compiler in `src/`.

## Wieder entfernen

1. `VITE_ENABLE_SVELTE_LAB` löschen oder `false`
2. Ordner `packages/svelte-lab/` entfernen
3. Optional löschen: `src/app/email/svelte-lab/`, `src/components/lab/`, Router-/SubNav-Einträge, Root-Scripts `svelte-lab:*`

Die Haupt-App bleibt unverändert nutzbar.
