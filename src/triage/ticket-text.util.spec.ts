import { hashText, normalizeTicketText } from './ticket-text.util';

describe('normalizeTicketText', () => {
  it('ignores case and whitespace differences', () => {
    const a = normalizeTicketText('Cannot  Login', 'I cannot\tlog in.  ');
    const b = normalizeTicketText('  cannot login', 'i cannot log in.');
    expect(a).toBe(b);
    expect(hashText(a)).toBe(hashText(b));
  });

  it('keeps subject and message separated', () => {
    expect(normalizeTicketText('Login', 'help')).toBe('login\nhelp');
  });
});
