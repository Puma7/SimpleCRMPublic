import type { EmailMessageRow } from '../email/email-store';
import { addressesFromRecipientJson } from '../email/email-parse-utils';
import { getSyncInfo } from '../sqlite-service';
import { listSpamListEntries } from '../email/email-spam-store';
import {
  evaluateSenderFilterFromLists as evaluateCoreSenderFilterFromLists,
  parseSenderList as parseCoreSenderList,
  type SenderFilterResult as CoreSenderFilterResult,
} from '../../packages/core/src/workflow';

export {
  BUILTIN_TRUSTED_SENDER_ENTRIES,
  extractSenderDomain,
  extractSenderEmail,
  matchSenderList,
  parseSenderList,
  type SenderFilterResult,
} from '../../packages/core/src/workflow';

const WHITELIST_KEY = 'workflow_sender_whitelist';
const BLACKLIST_KEY = 'workflow_sender_blacklist';

export function getGlobalSenderWhitelist(): string[] {
  try {
    return [
      ...parseCoreSenderList(getSyncInfo(WHITELIST_KEY)),
      ...listSpamListEntries('all')
        .filter((entry) => entry.list_type === 'allow' && entry.account_id == null)
        .map((entry) => entry.pattern),
    ];
  } catch {
    return parseCoreSenderList(getSyncInfo(WHITELIST_KEY));
  }
}

export function getGlobalSenderBlacklist(): string[] {
  try {
    return [
      ...parseCoreSenderList(getSyncInfo(BLACKLIST_KEY)),
      ...listSpamListEntries('all')
        .filter((entry) => entry.list_type === 'block' && entry.account_id == null)
        .map((entry) => entry.pattern),
    ];
  } catch {
    return parseCoreSenderList(getSyncInfo(BLACKLIST_KEY));
  }
}

export function evaluateSenderFilter(
  fromAddress: string,
  opts: {
    useGlobalLists?: boolean;
    useBuiltinTrusted?: boolean;
    extraWhitelist?: string;
    extraBlacklist?: string;
  } = {},
): CoreSenderFilterResult {
  const from = fromAddress.trim();
  if (!from) return 'default';

  const useGlobal = opts.useGlobalLists !== false;
  return evaluateCoreSenderFilterFromLists(from, {
    whitelist: useGlobal ? getGlobalSenderWhitelist() : [],
    blacklist: useGlobal ? getGlobalSenderBlacklist() : [],
    extraWhitelist: opts.extraWhitelist,
    extraBlacklist: opts.extraBlacklist,
    useBuiltinTrusted: opts.useBuiltinTrusted,
  });
}

/** Global lists only, for pre-workflow mail security without builtin trusted bypass. */
export function classifySenderForMessage(row: EmailMessageRow): CoreSenderFilterResult {
  const from = addressesFromRecipientJson(row.from_json);
  return evaluateSenderFilter(from, { useBuiltinTrusted: false });
}
