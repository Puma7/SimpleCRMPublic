import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import { useExternalLinkConfirm } from '@/components/email/external-link-confirm-dialog';

const mockOpenExternal = jest.fn();

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

jest.mock('@/components/email/external-link-open', () => ({
  openExternalUrlInBrowser: (...args: unknown[]) => mockOpenExternal(...args),
}));

function Harness() {
  const { handleBodyLinkClick, dialog } = useExternalLinkConfirm();
  return (
    <div>
      <div onClick={handleBodyLinkClick}>
        <a href="https://example.com/path">Sichere Adresse</a>
        <a href="javascript:alert(1)">Boese Adresse</a>
      </div>
      {dialog}
    </div>
  );
}

describe('useExternalLinkConfirm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete (window as any).electronAPI;
  });

  test('rejects an unsafe javascript: link with a toast and no dialog', () => {
    render(<Harness />);

    fireEvent.click(screen.getByText('Boese Adresse'));

    expect(toast.error).toHaveBeenCalledWith(
      'Dieser Link kann aus Sicherheitsgründen nicht geöffnet werden.',
    );
    expect(screen.queryByText('Link im Browser öffnen?')).not.toBeInTheDocument();
  });

  test('confirms a safe https link and opens it in the browser', async () => {
    render(<Harness />);

    fireEvent.click(screen.getByText('Sichere Adresse'));

    // Dialog shows the exact URL for the user to verify.
    expect(screen.getByText('Link im Browser öffnen?')).toBeInTheDocument();
    expect(screen.getByText('https://example.com/path')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Im Browser öffnen' }));

    await waitFor(() =>
      expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com/path'),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });
});
