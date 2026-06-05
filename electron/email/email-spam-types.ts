import type {
  SpamListType,
  SpamPatternType,
} from '../../packages/core/src/email';

export type {
  SpamListType,
  SpamPatternType,
  SpamScoreBreakdown,
  SpamScoreReason,
  SpamStatus,
  SpamTrainingLabel,
} from '../../packages/core/src/email';

export type SpamListEntry = {
  id: number;
  list_type: SpamListType;
  pattern_type: SpamPatternType;
  pattern: string;
  account_id: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};
