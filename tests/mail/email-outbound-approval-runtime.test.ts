jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: jest.fn(),
  setSyncInfo: jest.fn(),
}));

jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: jest.fn(),
  setOutboundHold: jest.fn(),
  updateComposeDraft: jest.fn(),
}));

jest.mock('../../electron/email/email-outbound-review-parse', () => ({
  extractDraftBodyForOutboundBlock: jest.fn(),
}));

jest.mock('../../electron/email/email-ticket', () => ({
  createTicketCodeForAccount: jest.fn(() => 'TICKET-NEW'),
  ensureTicketInSubject: jest.fn((subject: string, ticket: string) => `${subject} [${ticket}]`),
  extractKnownTicketFromSubject: jest.fn(() => null),
}));

import { encodeOutboundApprovalMarker, outboundDraftFingerprint } from '../../packages/core/src/email/outbound-approval-marker';
import { getSyncInfo, setSyncInfo } from '../../electron/sqlite-service';
import {
  getEmailMessageById,
  setOutboundHold,
  updateComposeDraft,
} from '../../electron/email/email-store';
import { extractDraftBodyForOutboundBlock } from '../../electron/email/email-outbound-review-parse';
import {
  createTicketCodeForAccount,
  extractKnownTicketFromSubject,
} from '../../electron/email/email-ticket';
import {
  applyManualComposeOutboundApproval,
  clearOutboundApprovalMarker,
  outboundReviewApprovedKey,
  stampOutboundApprovalMarker,
  tryOutboundApprovalBypass,
} from '../../electron/email/outbound-approval';

const getSyncInfoMock = getSyncInfo as jest.MockedFunction<typeof getSyncInfo>;
const setSyncInfoMock = setSyncInfo as jest.MockedFunction<typeof setSyncInfo>;
const getMessageMock = getEmailMessageById as jest.MockedFunction<typeof getEmailMessageById>;
const extractBodyMock = extractDraftBodyForOutboundBlock as jest.MockedFunction<
  typeof extractDraftBodyForOutboundBlock
>;
const extractTicketMock = extractKnownTicketFromSubject as jest.MockedFunction<
  typeof extractKnownTicketFromSubject
>;

const fingerprintInput = {
  subject: 'Angebot',
  bodyText: 'Hallo',
  bodyHtml: '<p>Hallo</p>',
  to: 'kunde@example.com',
  cc: null,
  bcc: null,
  attachmentPaths: ['angebot.pdf'],
};

describe('outbound approval marker lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-07-14T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('uses a stable per-draft storage key and no marker means no bypass', () => {
    getSyncInfoMock.mockReturnValue(null);

    expect(outboundReviewApprovedKey(17)).toBe('outbound_review_approved:17');
    expect(tryOutboundApprovalBypass(17, fingerprintInput)).toBe(false);
    expect(setSyncInfoMock).not.toHaveBeenCalled();
  });

  test('accepts a fresh matching marker and a fresh legacy marker', () => {
    const fingerprint = outboundDraftFingerprint(fingerprintInput);
    getSyncInfoMock
      .mockReturnValueOnce(encodeOutboundApprovalMarker(new Date(), fingerprint))
      .mockReturnValueOnce(new Date().toISOString());

    expect(tryOutboundApprovalBypass(17, fingerprintInput)).toBe(true);
    expect(tryOutboundApprovalBypass(18, fingerprintInput)).toBe(true);
    expect(setSyncInfoMock).not.toHaveBeenCalled();
  });

  test('clears stale, malformed and content-mismatched markers', () => {
    const stale = encodeOutboundApprovalMarker(
      new Date(Date.now() - 25 * 60 * 60 * 1000),
      outboundDraftFingerprint(fingerprintInput),
    );
    const changed = encodeOutboundApprovalMarker(
      new Date(),
      outboundDraftFingerprint({ ...fingerprintInput, bodyText: 'Anderer Inhalt' }),
    );
    getSyncInfoMock
      .mockReturnValueOnce(stale)
      .mockReturnValueOnce(changed)
      .mockReturnValueOnce('not-a-date');

    expect(tryOutboundApprovalBypass(1, fingerprintInput)).toBe(false);
    expect(tryOutboundApprovalBypass(2, fingerprintInput)).toBe(false);
    expect(tryOutboundApprovalBypass(3, fingerprintInput)).toBe(false);
    expect(setSyncInfoMock).toHaveBeenNthCalledWith(1, outboundReviewApprovedKey(1), '');
    expect(setSyncInfoMock).toHaveBeenNthCalledWith(2, outboundReviewApprovedKey(2), '');
    expect(setSyncInfoMock).toHaveBeenNthCalledWith(3, outboundReviewApprovedKey(3), '');
  });

  test('stamps and clears a fingerprint-bound marker', () => {
    stampOutboundApprovalMarker(22, fingerprintInput);
    expect(setSyncInfoMock).toHaveBeenCalledWith(
      outboundReviewApprovedKey(22),
      encodeOutboundApprovalMarker(new Date(), outboundDraftFingerprint(fingerprintInput)),
    );

    clearOutboundApprovalMarker(22);
    expect(setSyncInfoMock).toHaveBeenLastCalledWith(outboundReviewApprovedKey(22), '');
  });
});

describe('manual compose approval', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-07-14T12:00:00.000Z'));
    extractBodyMock.mockReturnValue({ plain: 'Bereinigt', html: '<p>Bereinigt</p>' });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('does nothing when the draft disappeared', () => {
    getMessageMock.mockReturnValue(undefined);

    applyManualComposeOutboundApproval(404, fingerprintInput);

    expect(updateComposeDraft).not.toHaveBeenCalled();
    expect(setOutboundHold).not.toHaveBeenCalled();
    expect(setSyncInfoMock).not.toHaveBeenCalled();
  });

  test('normalizes, tickets, releases and fingerprints a persisted draft', () => {
    getMessageMock.mockReturnValue({
      id: 31,
      account_id: 9,
      subject: 'Alter Betreff',
      ticket_code: null,
      body_text: 'Alt',
      body_html: '<p>Alt</p>',
      to_json: JSON.stringify({ value: [{ address: 'stored@example.com' }] }),
      cc_json: JSON.stringify({ value: [{ address: 'cc@example.com' }] }),
      bcc_json: null,
      draft_attachment_paths_json: JSON.stringify(['stored.pdf']),
    } as never);

    applyManualComposeOutboundApproval(31, {
      subject: ' Neuer Betreff ',
      bodyText: 'Neu',
      bodyHtml: '<p>Neu</p>',
    });

    expect(extractBodyMock).toHaveBeenCalledWith(
      { body_text: 'Alt', body_html: '<p>Alt</p>' },
      { bodyText: 'Neu', bodyHtml: '<p>Neu</p>' },
    );
    expect(createTicketCodeForAccount).toHaveBeenCalledWith(9);
    expect(updateComposeDraft).toHaveBeenCalledWith(31, {
      subject: 'Neuer Betreff [TICKET-NEW]',
      bodyText: 'Bereinigt',
      bodyHtml: '<p>Bereinigt</p>',
    });
    expect(setOutboundHold).toHaveBeenCalledWith(31, false, null);
    expect(setSyncInfoMock).toHaveBeenCalledWith(
      outboundReviewApprovedKey(31),
      expect.stringMatching(/^2026-07-14T12:00:00\.000Z\|[a-f0-9]{32}$/),
    );
  });

  test('preserves an existing ticket and accepts empty cleaned HTML', () => {
    extractTicketMock.mockReturnValueOnce('TICKET-OLD');
    extractBodyMock.mockReturnValueOnce({ plain: 'Nur Text', html: '' });
    getMessageMock.mockReturnValue({
      id: 32,
      account_id: 9,
      subject: 'Vorhanden',
      ticket_code: 'ROW-TICKET',
      body_text: null,
      body_html: null,
      to_json: null,
      cc_json: null,
      bcc_json: null,
      draft_attachment_paths_json: null,
    } as never);

    applyManualComposeOutboundApproval(32, { subject: ' ' });

    expect(createTicketCodeForAccount).not.toHaveBeenCalled();
    expect(updateComposeDraft).toHaveBeenCalledWith(32, {
      subject: 'Vorhanden [TICKET-OLD]',
      bodyText: 'Nur Text',
      bodyHtml: null,
    });
  });
});
