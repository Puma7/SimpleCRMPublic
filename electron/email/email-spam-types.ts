export type SpamStatus = 'clean' | 'review' | 'spam';
export type SpamListType = 'allow' | 'block';
export type SpamPatternType = 'email' | 'domain';
export type SpamTrainingLabel = 'spam' | 'ham';

export type SpamScoreReason = {
  code: string;
  label: string;
  points: number;
};

export type SpamScoreBreakdown = {
  score: number;
  status: SpamStatus;
  source: string;
  reasons: SpamScoreReason[];
  featureKeys: string[];
  listMatch?: {
    listType: SpamListType;
    patternType: SpamPatternType;
    pattern: string;
    specificity: number;
  };
  modelVersion: number;
};

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
