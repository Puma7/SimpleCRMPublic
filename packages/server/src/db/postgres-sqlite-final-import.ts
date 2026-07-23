import {
  buildCoreCrmImportCommands,
  runPostgresCoreCrmImport,
  type CoreCrmImportCommand,
  type CoreCrmImportPgClient,
} from './postgres-core-crm-import';
import {
  buildCoreMailImportCommands,
  runPostgresCoreMailImport,
  type CoreMailImportCommand,
  type CoreMailImportPgClient,
} from './postgres-core-mail-import';
import {
  buildWorkflowSecurityImportCommands,
  runPostgresWorkflowSecurityImport,
  type WorkflowSecurityImportCommand,
  type WorkflowSecurityImportPgClient,
} from './postgres-workflow-security-import';

export type PostgresSqliteFinalImportClient =
  CoreCrmImportPgClient
  & CoreMailImportPgClient
  & WorkflowSecurityImportPgClient;

export type PostgresSqliteFinalImportDomain = 'core_crm' | 'core_mail' | 'workflow_security';

export type PostgresSqliteFinalImportInput = Readonly<{
  workspaceId: string;
  runId: string;
  domains?: readonly PostgresSqliteFinalImportDomain[];
}>;

export type PostgresSqliteFinalImportCommand = Readonly<{
  domain: PostgresSqliteFinalImportDomain;
  tableName: string;
  prepareSql?: string;
  sql: string;
  params: readonly unknown[];
}>;

export type PostgresSqliteFinalImportDomainResult = Readonly<{
  domain: PostgresSqliteFinalImportDomain;
  tableNames: readonly string[];
  commandCount: number;
}>;

export type PostgresSqliteFinalImportResult = Readonly<{
  workspaceId: string;
  runId: string;
  domains: readonly PostgresSqliteFinalImportDomainResult[];
}>;

const defaultDomainOrder: readonly PostgresSqliteFinalImportDomain[] = [
  'core_crm',
  'core_mail',
  'workflow_security',
];

export async function runPostgresSqliteFinalImport(
  client: PostgresSqliteFinalImportClient,
  input: PostgresSqliteFinalImportInput,
): Promise<PostgresSqliteFinalImportResult> {
  const domains = normalizeDomains(input.domains);
  validateFinalImportInput(input);
  const results: PostgresSqliteFinalImportDomainResult[] = [];

  for (const domain of domains) {
    switch (domain) {
      case 'core_crm': {
        const commands = buildCoreCrmImportCommands(input);
        await runPostgresCoreCrmImport(client, input);
        results.push(domainResult(domain, commands));
        break;
      }
      case 'core_mail': {
        const commands = buildCoreMailImportCommands(input);
        await runPostgresCoreMailImport(client, input);
        results.push(domainResult(domain, commands));
        break;
      }
      case 'workflow_security': {
        const commands = buildWorkflowSecurityImportCommands(input);
        await runPostgresWorkflowSecurityImport(client, input);
        results.push(domainResult(domain, commands));
        break;
      }
      default:
        assertNever(domain);
    }
  }

  return {
    workspaceId: input.workspaceId,
    runId: input.runId,
    domains: results,
  };
}

export function buildPostgresSqliteFinalImportCommands(
  input: PostgresSqliteFinalImportInput,
): readonly PostgresSqliteFinalImportCommand[] {
  validateFinalImportInput(input);
  return normalizeDomains(input.domains).flatMap((domain) => commandsForDomain(domain, input));
}

function commandsForDomain(
  domain: PostgresSqliteFinalImportDomain,
  input: PostgresSqliteFinalImportInput,
): readonly PostgresSqliteFinalImportCommand[] {
  switch (domain) {
    case 'core_crm':
      return buildCoreCrmImportCommands(input).map((command) => withDomain(domain, command));
    case 'core_mail':
      return buildCoreMailImportCommands(input).map((command) => withDomain(domain, command));
    case 'workflow_security':
      return buildWorkflowSecurityImportCommands(input).map((command) => withDomain(domain, command));
    default:
      return assertNever(domain);
  }
}

function withDomain(
  domain: PostgresSqliteFinalImportDomain,
  command: CoreCrmImportCommand | CoreMailImportCommand | WorkflowSecurityImportCommand,
): PostgresSqliteFinalImportCommand {
  return {
    domain,
    tableName: command.tableName,
    ...('prepareSql' in command && command.prepareSql ? { prepareSql: command.prepareSql } : {}),
    sql: command.sql,
    params: command.params,
  };
}

function domainResult(
  domain: PostgresSqliteFinalImportDomain,
  commands: readonly (CoreCrmImportCommand | CoreMailImportCommand | WorkflowSecurityImportCommand)[],
): PostgresSqliteFinalImportDomainResult {
  return {
    domain,
    tableNames: commands.map((command) => command.tableName),
    commandCount: commands.length,
  };
}

function validateFinalImportInput(input: PostgresSqliteFinalImportInput): void {
  if (!input.workspaceId.trim()) {
    throw new Error('workspaceId is required for final SQLite import');
  }
  if (!input.runId.trim()) {
    throw new Error('runId is required for final SQLite import');
  }
}

function normalizeDomains(
  domains: readonly PostgresSqliteFinalImportDomain[] | undefined,
): readonly PostgresSqliteFinalImportDomain[] {
  if (domains === undefined) {
    return defaultDomainOrder;
  }
  if (domains.length === 0) {
    throw new Error('At least one final SQLite import domain is required');
  }

  const seen = new Set<PostgresSqliteFinalImportDomain>();
  for (const domain of domains) {
    if (!defaultDomainOrder.includes(domain)) {
      throw new Error(`Unknown final SQLite import domain: ${domain}`);
    }
    if (seen.has(domain)) {
      throw new Error(`Duplicate final SQLite import domain: ${domain}`);
    }
    seen.add(domain);
  }

  return defaultDomainOrder.filter((domain) => seen.has(domain));
}

function assertNever(value: never): never {
  throw new Error(`Unexpected final SQLite import domain: ${value}`);
}
