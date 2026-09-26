/**
 * Deal stages that count as closed in dashboard and follow-up queries of both
 * editions. The UI writes the German names ('Gewonnen'/'Verloren' plus the
 * 'Abgeschlossen …' variants from DealStage); 'Closed Won'/'Closed Lost' are
 * legacy names from older databases.
 */
export const WON_DEAL_STAGES = ['Gewonnen', 'Abgeschlossen Gewonnen', 'Closed Won'] as const;
export const LOST_DEAL_STAGES = ['Verloren', 'Abgeschlossen Verloren', 'Closed Lost'] as const;
export const CLOSED_DEAL_STAGES = [...WON_DEAL_STAGES, ...LOST_DEAL_STAGES] as const;
