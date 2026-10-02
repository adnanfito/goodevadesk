import { detectTicketLanguage } from './language.util';

describe('detectTicketLanguage', () => {
  it.each([
    'tidak bisa login\nsaya tidak bisa login ke akun saya sejak tadi pagi',
    'error 500 saat export csv\nsetiap kali saya klik tombol export csv di dashboard, muncul error 500',
    'refund langganan\nsaya sudah berhenti pakai tapi masih ditagih biaya langganan bulan ini',
    'program partner\nhalo, perusahaan kami tertarik bekerja sama sebagai reseller goodevadesk. siapa yang bisa saya hubungi?',
    'webhook\nwebhook ke server kami berhenti sejak deploy terakhir',
    'tagihan dobel\nkartu saya ditagih dua kali bulan ini',
  ])('detects Indonesian: %s', (text) => {
    expect(detectTicketLanguage(text)).toBe('id');
  });

  it.each([
    'password reset email not arriving\ni requested a password reset three times but never received the email',
    'charged twice this month\nhi, my credit card was charged twice for the pro plan this month',
    'app crashes on startup\nthe mobile app crashes right after the splash screen',
    'error 500\ndashboard shows error 500 when exporting csv',
    'partnership inquiry\nhello, we are a software agency and would like to become a reseller',
  ])('detects English: %s', (text) => {
    expect(detectTicketLanguage(text)).toBe('en');
  });

  it('returns und for text without letters', () => {
    expect(detectTicketLanguage('500 !!! 123')).toBe('und');
  });
});
