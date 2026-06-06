import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { I18nProvider, translate, useTranslation } from '../../src/lib/i18n';

function Probe() {
  const { t, language, setLanguage } = useTranslation();
  return (
    <div>
      <span data-testid="lang">{language}</span>
      <span data-testid="text">{t('nav.tasks')}</span>
      <button type="button" onClick={() => setLanguage('en')}>to-en</button>
    </div>
  );
}

describe('i18n', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('translate returns the requested language and interpolates params', () => {
    expect(translate('de', 'common.save')).toBe('Speichern');
    expect(translate('en', 'common.save')).toBe('Save');
    expect(translate('de', 'userGroups.memberCount', { count: 3 })).toBe('3 Mitglieder');
    expect(translate('en', 'userGroups.memberCount', { count: 3 })).toBe('3 members');
  });

  test('falls back to German for components rendered without a provider', () => {
    render(<Probe />);
    expect(screen.getByTestId('lang')).toHaveTextContent('de');
    expect(screen.getByTestId('text')).toHaveTextContent('Aufgaben');
  });

  test('switches language and persists the choice', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    expect(screen.getByTestId('text')).toHaveTextContent('Aufgaben');

    fireEvent.click(screen.getByRole('button', { name: 'to-en' }));

    expect(screen.getByTestId('lang')).toHaveTextContent('en');
    expect(screen.getByTestId('text')).toHaveTextContent('Tasks');
    expect(window.localStorage.getItem('simplecrm.language.v1')).toBe('en');
  });

  test('restores the stored language on mount', () => {
    window.localStorage.setItem('simplecrm.language.v1', 'en');
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('text')).toHaveTextContent('Tasks');
  });
});
