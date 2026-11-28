const kana = /^[\p{Script=Hiragana}\p{Script=Katakana}ー・\s]+$/u;
const kanaLetter = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const ruby = /([\p{Script=Han}々]+[\p{Script=Hiragana}ー]*)\s*[（(]([\p{Script=Hiragana}\p{Script=Katakana}ー・]+)[）)]/gu;
const romaji = /([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々](?:_{3,}|＿{3,})?[。！？.!?…」』”’"']*(?:[^\S\r\n]*<\/ja>[。！？.!?…」』”’"']*)?)\s*[（(][^\S\r\n]*((?:[_＿]+[^\S\r\n]*)?[a-zāīūēō][a-zāīūēō'’.,!?_\-＿\p{Zs}\t]*)([）)]|$)/giu;
const isRomajiReading = reading => !/^[A-Z]{2,}$/.test(reading.trim());
const closingQuote = {'「':'」','『':'』','"':'"',"'":"'",'“':'”','‘':'’','（':'）','(':')'};
const citedParticle = /([「『"'“‘（(])(\s*)([はへ])(\s*)([」』"'”’）)])/gu;
const particleSound = particle => particle === 'は' ? 'わ' : 'え';
export const voiceBlank = /(?:_{3,}|＿{3,})/u;
export const isVoiceBlankOnly = text => voiceBlank.test(text) && /^[\s\p{P}]+$/u.test(text);

export function* voiceRomajiAnnotations(text, {unfinished = false} = {}) {
  for (const match of text.matchAll(romaji)) {
    if (match[3] ? isRomajiReading(match[2]) : unfinished) {
      yield [match.index + match[1].length, match.index + match[0].length];
    }
  }
}

export function authoredVoiceReading(reading) {
  const value = typeof reading === 'string' ? reading.normalize('NFC').trim() : '';
  return kana.test(value) && kanaLetter.test(value) ? value : '';
}

export function normalizeVoiceText(text, {kanjiMode = 'kanji_native'} = {}) {
  const group = kanjiMode === 'kana_first' ? '$2' : '$1';
  return text.normalize('NFC')
    .replace(/<(?!\/?(?:ja|vi)>)[^>]*>/gi, ' ')
    .replace(/\[([^\]\r\n]+)\]\([^\s)]+\)/g, '$1')
    .replace(/([\d０-９][%％]?[\p{Zs}\t]*[〜～](?=[\p{Zs}\t]*[\d０-９])|_{3,})|[#*`_〜～]/gu, '$1')
    // Paired underscore emphasis at word boundaries is markup, not two exercise blanks.
    .replace(/(?<![\p{L}\p{M}\p{N}_])(_{3,})(?![\s_])([^_<>→\r\n]*[^\s_<>→\r\n])\1(?![\p{L}\p{M}\p{N}_])/gu, '$2')
    .replace(/\{([^{}|]+)\|([\p{Script=Hiragana}\p{Script=Katakana}ー・\s]+)\}/gu, group)
    .replace(ruby, group)
    .replace(romaji, (annotation, spoken, reading, close) => close && isRomajiReading(reading) ? spoken : annotation)
    .trim();
}

// Keep orthographic particle spellings in longer transcripts; change citations only for synthesis.
export function particleReading(text) {
  text = text.replace(citedParticle, (quote, open, before, particle, after, close) =>
    closingQuote[open] === close ? open + before + particleSound(particle) + after + close : quote);
  return text.replace(/^(\s*[「『"'（(]?)([はへ])([」』"'）)]?[。、.!?！？,\s]*)$/u,
    (_, prefix, particle, suffix) => prefix + particleSound(particle) + suffix);
}
