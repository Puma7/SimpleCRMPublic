const mockToastError = jest.fn();

jest.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

import { handleApiError } from '@/lib/api-error-handler';

describe('handleApiError', () => {
  beforeEach(() => {
    mockToastError.mockReset();
  });

  test('shows toast with context title', () => {
    handleApiError(new Error('Something failed'), 'fetching customers');

    expect(mockToastError).toHaveBeenCalledWith('Fehler: fetching customers', {
      description: 'Something failed',
    });
  });

  test('uses Error.message as description', () => {
    handleApiError(new Error('Connection refused'), 'saving data');

    expect(mockToastError).toHaveBeenCalledWith('Fehler: saving data', {
      description: 'Connection refused',
    });
  });

  test('uses string error directly', () => {
    handleApiError('Something went wrong', 'loading products');

    expect(mockToastError).toHaveBeenCalledWith('Fehler: loading products', {
      description: 'Something went wrong',
    });
  });

  test('uses errorDetails.userMessage when available', () => {
    const error = {
      errorDetails: {
        userMessage: 'Verbindung zum Server fehlgeschlagen',
        suggestion: 'Prüfen Sie Ihre Netzwerkverbindung',
      },
    };

    handleApiError(error, 'connecting');

    expect(mockToastError).toHaveBeenCalledWith(
      'Fehler: connecting',
      expect.objectContaining({
        description: expect.stringContaining('Verbindung zum Server fehlgeschlagen'),
      }),
    );
  });

  test('appends suggestion when errorDetails.suggestion present', () => {
    const error = {
      errorDetails: {
        userMessage: 'Auth failed',
        suggestion: 'Check credentials',
      },
    };

    handleApiError(error, 'login');

    const call = mockToastError.mock.calls[0];
    expect(call?.[1]?.description).toContain('Auth failed');
    expect(call?.[1]?.description).toContain('Check credentials');
    expect(call?.[1]?.description).toContain('Lösungsvorschlag');
  });

  test('uses backend error string from { success: false, error: "..." } shape', () => {
    const backendError = { success: false, error: 'Record not found' };

    handleApiError(backendError, 'deleting customer');

    expect(mockToastError).toHaveBeenCalledWith('Fehler: deleting customer', {
      description: 'Record not found',
    });
  });

  test('uses fallback message for null error', () => {
    handleApiError(null, 'unknown operation');

    expect(mockToastError).toHaveBeenCalledWith('Fehler: unknown operation', {
      description: 'Ein unerwarteter Fehler ist aufgetreten.',
    });
  });

  test('uses custom fallback message when provided', () => {
    handleApiError(null, 'something', 'Benutzerdefinierter Fehler');

    expect(mockToastError).toHaveBeenCalledWith('Fehler: something', {
      description: 'Benutzerdefinierter Fehler',
    });
  });

  test('uses fallback for empty string error', () => {
    handleApiError('', 'test context');

    expect(mockToastError).toHaveBeenCalledWith('Fehler: test context', {
      description: 'Ein unerwarteter Fehler ist aufgetreten.',
    });
  });

  test('uses fallback when errorDetails has no userMessage, still appends suggestion', () => {
    const error = {
      errorDetails: {
        suggestion: 'Try again',
      },
    };

    handleApiError(error, 'context');

    const call = mockToastError.mock.calls[0];
    expect(call?.[1]?.description).toContain('Ein unerwarteter Fehler ist aufgetreten.');
    expect(call?.[1]?.description).toContain('Try again');
  });

  test('uses Error fallback message when error.message is empty', () => {
    const err = new Error('');
    handleApiError(err, 'context');

    expect(mockToastError).toHaveBeenCalledWith('Fehler: context', {
      description: 'Ein unerwarteter Fehler ist aufgetreten.',
    });
  });

  test('uses errorDetails.userMessage over Error.message', () => {
    const error = new Error('low-level error');
    (error as { errorDetails?: { userMessage: string } }).errorDetails = {
      userMessage: 'Benutzerfreundliche Meldung',
    };

    handleApiError(error, 'context');

    expect(mockToastError).toHaveBeenCalledWith('Fehler: context', {
      description: 'Benutzerfreundliche Meldung',
    });
  });
});
