# SimpleCRM Integration Check: Email & Workflow Automation

This document evaluates integration options for adding **email functionality** and **workflow automation** to SimpleCRM (Electron + React + TypeScript + SQLite).

---

## 1. Email Integration

### Recommended Core Stack

| Layer | Package | npm | Notes |
|---|---|---|---|
| **IMAP** | ImapFlow | `imapflow` | Modern, async/await, TypeScript defs, XOAUTH2 built-in |
| **SMTP Sending** | Nodemailer | `nodemailer` | 13M+ weekly downloads, zero deps, DKIM/OAuth2 support |
| **Email Parsing** | mailparser | `mailparser` | Same author as Nodemailer, handles MIME/attachments |
| **Google OAuth2** | Google APIs | `googleapis` | Required for Gmail (basic auth phased out) |
| **Microsoft OAuth2** | MSAL Node | `@azure/msal-node` | Required for Outlook 365 |
| **POP3 (optional)** | node-pop3 | `node-pop3` | Only if POP3 support needed |

All three core libraries (ImapFlow, Nodemailer, mailparser) are maintained by the same author (Andris Reinman) and work well together.

### Email Threading

- Use the **JWZ Threading Algorithm** (Message-ID, In-Reply-To, References headers)
- JS reference implementation: [conversationThreading-js](https://github.com/max-mapper/conversationThreading-js)
- ImapFlow can leverage server-side THREAD extension (RFC 5256) when available

### OAuth2 Integration with ImapFlow

```typescript
const client = new ImapFlow({
    host: 'imap.gmail.com', // or 'outlook.office365.com'
    port: 993,
    secure: true,
    auth: {
        user: 'user@example.com',
        accessToken: '<oauth2-access-token>' // ImapFlow handles XOAUTH2
    }
});
```

### Reference Architecture: Mailspring

[Mailspring](https://github.com/Foundry376/Mailspring) (GPLv3) is the most relevant open-source Electron email client:
- Electron + React stack (similar to SimpleCRM)
- Separates mail sync engine from UI via local database
- Plugin architecture for extensibility
- Key learning: Sync engine as a separate process communicating via SQLite is a proven performance pattern

### Integration with SimpleCRM

SimpleCRM already uses SQLite (`better-sqlite3`) and has an IPC architecture (`electron/ipc/`). Email integration would fit naturally:

1. **New Electron service** (`electron/email-service.ts`) using ImapFlow + Nodemailer
2. **New IPC handlers** in `electron/ipc/` for email operations
3. **New database tables** via `electron/database-schema.ts` for emails, threads, accounts
4. **New React views** in `src/app/email/` for inbox, compose, thread view
5. **Link emails to customers** using the existing customer model

---

## 2. Workflow / Automation Engine

### Recommended: React Flow + Custom Engine

| Component | Package | npm | Role |
|---|---|---|---|
| **Visual Editor** | React Flow | `@xyflow/react` | Node-based UI for building workflows |
| **Execution Engine** | Custom or ts-edge | `ts-edge` | Runs the workflow graph |
| **State Management** | Zustand | `zustand` | Already in SimpleCRM's ecosystem |

### Why React Flow?

- 600K+ weekly downloads, MIT license
- Nodes are plain React components (full customization)
- First-class TypeScript support
- Built-in drag-and-drop, zoom, pan, multi-select
- [Workflow Editor template](https://reactflow.dev/ui/templates/workflow-editor) available
- [Email automation tutorial](https://novu.co/blog/building-an-email-automation-system-with-react-flow-and-resend) exists
- Compatible with shadcn/ui (which SimpleCRM already uses)

### Alternatives Evaluated

| Option | Verdict | Reason |
|---|---|---|
| **Flume** | Good alternative | Built-in execution engine + editor, but smaller community |
| **Rete.js** | Overkill | More flexible but more complex setup |
| **Node-RED embedded** | Viable but heavy | Full engine + editor, but UI is not React |
| **Reaflow** | Less mature | Smaller ecosystem than React Flow |
| **Drawflow** | No React support | Would need custom wrapper |
| **BaklavaJS** | Vue-only | Not compatible with React stack |

### Integration with SimpleCRM

1. **New React views** in `src/app/workflows/` with React Flow editor
2. **Workflow definitions stored as JSON** in SQLite (nodes + edges)
3. **Execution engine** in Electron main process (`electron/workflow-engine.ts`)
4. **Trigger types**: Manual, scheduled (cron), on email received, on deal stage change, on customer created
5. **Action nodes**: Send email, create task, update deal, notify user, HTTP request

### Example Workflow: Auto-follow-up

```
[Email Received] → [Check Customer Exists?]
                        ├── Yes → [Link to Customer] → [Create Follow-up Task]
                        └── No  → [Create Customer] → [Create Follow-up Task]
```

---

## 3. Implementation Priority

### Phase 1: Email Foundation
- Add ImapFlow, Nodemailer, mailparser dependencies
- Create email service in Electron main process
- Add email account configuration UI (Settings page)
- Basic inbox view with send/receive

### Phase 2: Email-CRM Integration
- Link emails to customers (auto-match by email address)
- Show email history on customer detail page
- Email threading with JWZ algorithm
- OAuth2 for Gmail and Outlook

### Phase 3: Workflow Automation
- Add React Flow visual editor
- Build workflow execution engine
- Create standard node types (email, task, deal, condition, delay)
- Trigger system (manual, scheduled, event-based)

### Phase 4: Advanced Features
- Email templates with variable substitution
- Bulk email campaigns
- Workflow analytics and logging
- Import/export workflows as JSON

---

## 4. Compatibility Notes

- All recommended packages work with **Electron** and **Node.js**
- **React Flow** is compatible with **React 18+**, **TypeScript**, and **shadcn/ui**
- **ImapFlow** works in the **Electron main process** (Node.js context)
- **SQLite** (already used) can store both emails and workflow definitions
- **IPC pattern** (already established in `electron/ipc/`) extends naturally for new services

---

## 5. Package Size Impact

| Package | Unpacked Size | Dependencies |
|---|---|---|
| imapflow | ~200KB | minimal |
| nodemailer | ~500KB | zero |
| mailparser | ~300KB | iconv-lite, libmime |
| @xyflow/react | ~1MB | minimal |
| googleapis | ~50MB | large (consider `google-auth-library` alone ~5MB) |
| @azure/msal-node | ~2MB | moderate |

**Recommendation**: For Google OAuth2, use `google-auth-library` (~5MB) instead of the full `googleapis` (~50MB) package since only the auth flow is needed.
