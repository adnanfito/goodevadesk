import { detect } from 'tinyld';

export type TicketLanguage = 'id' | 'en' | 'und';

const words = (list: string) => new Set(list.trim().split(/\s+/));

// High-frequency function words that rarely appear in the other language.
const INDONESIAN = words(`
  yang dan di ke dari saya kami kita anda tidak bisa ini itu untuk dengan
  sudah belum tapi tetapi mau ingin mohon tolong bagaimana apakah kenapa
  mengapa siapa halo terima kasih akun saat sejak setiap kali masih juga ada
  karena atau sebagai pada akan bulan muncul gagal dua minta caranya sama ya nya
`);
const ENGLISH = words(`
  the and to of in is are was i my me we our you your it this that not cannot
  can't can please for with but have has been would could hello hi thanks
  thank when how why who since every still also from on at twice never received
`);

/**
 * Detects whether a ticket is Indonesian or English (the two languages the
 * support team handles). Used to keep semantic cache hits within the same
 * language, since the multilingual embedding model matches across languages
 * but a cached reply is written in one language only.
 */
export function detectTicketLanguage(text: string): TicketLanguage {
  const tokens = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  let id = 0;
  let en = 0;
  for (const token of tokens) {
    if (INDONESIAN.has(token)) id++;
    if (ENGLISH.has(token)) en++;
  }
  if (id !== en) return id > en ? 'id' : 'en';

  // Tie (e.g. very short text): fall back to a statistical detector.
  const detected = detect(text, { only: ['id', 'en'] });
  return detected === 'id' || detected === 'en' ? detected : 'und';
}
