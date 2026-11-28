import {isVoiceBlankOnly, voiceBlank, voiceRomajiAnnotations} from './normalizer.js';

export const MAX_SEGMENTS = 16;
const japanese = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々]/u;
const letter = /\p{L}/u;
const sentenceEnd = /[。！？.!?…][」』”’"')）]*$/u;
const trailingPrefix = /([\s]*[「『“‘（(]+[\s]*)$/u;
const leadingNumber = /(?:^|\s)([\d０-９]+(?:[.,，][\d０-９]+)?[%％]?(?:[\p{Zs}\t]*[〜～][\p{Zs}\t]*[\d０-９]+(?:[.,，][\d０-９]+)?[%％]?)?[\p{Zs}\t]*)$/u;
const latinWord = /[\p{Script=Latin}][\p{Script=Latin}\p{M}0-9-]*|./gsu;
const acronym = /^[A-ZＡ-Ｚ][A-ZＡ-Ｚ0-9０-９-]*$/u;
const numeral = /^[\d０-９][\d０-９.,，、:：%％〜～\s]*[。！？!?]?$/u;
const clauseEnd = /[\r\n。！？.!?…]/u;
const arrows = /(→)/u;
const synthesisBreaks = new RegExp(`(→|${voiceBlank.source})`, 'u');

export function segmentVoiceText(text, mode = 'bilingual', {hint, blankHint = 'ja', mixLanguages = false, splitBlanks = false} = {}) {
  const segments = [], mixed = mixLanguages && mode === 'bilingual';
  const labelledText = value => numeral.test(value) || !splitBlanks && isVoiceBlankOnly(value);
  const blankLanguage = () => hint ?? segments.at(-1)?.lang ?? blankHint;
  let nextBoundary = 'start', combined = '', labelledNonLetter = false, japaneseLabel = false;
  function finishCombined() {
    const value = combined.trim();
    const blank = !splitBlanks && isVoiceBlankOnly(value);
    if (labelledNonLetter || blank || letter.test(value)) {
      const lang = japaneseLabel || japanese.test(value) ? 'ja' : blank && !labelledNonLetter ? blankLanguage() : 'vi';
      segments.push({lang,text:value,boundary:nextBoundary});
      nextBoundary = 'inline';
    }
    combined = '';
    labelledNonLetter = japaneseLabel = false;
    return segments.length <= MAX_SEGMENTS;
  }
  function markBoundary(boundary) {
    if (mixed && !finishCombined()) return false;
    if (segments.length && nextBoundary !== 'blank') nextBoundary = boundary;
    return true;
  }
  const add = (lang, raw, labelled = false) => {
    const value = raw.trim();
    if ((!letter.test(value) && !(labelled && labelledText(value))) || (mode === 'ja' && lang !== 'ja')) return;
    const previous = segments.at(-1);
    if (previous?.lang === lang && nextBoundary === 'inline') {
      previous.text += ' ' + value;
    } else {
      segments.push({lang, text:value, boundary:nextBoundary !== 'inline' ? nextBoundary
        : sentenceEnd.test(previous.text) ? 'sentence' : 'inline'});
    }
    nextBoundary = 'inline';
  };
  function plain(value, explicit) {
    if (mixed) {
      if (/[\p{Script=Latin}\p{M}\p{N}]$/u.test(combined) && /^[\p{Script=Latin}\p{N}]/u.test(value)) combined += ' ';
      combined += value;
      if (explicit && labelledText(value.trim())) {
        labelledNonLetter = true;
        japaneseLabel ||= explicit === 'ja';
      }
      return;
    }
    if (explicit) return add(explicit, value, true);
    const trimmed = value.trim();
    if (!splitBlanks && isVoiceBlankOnly(trimmed)) return add(blankLanguage(), trimmed, true);
    if (hint && numeral.test(trimmed)) return add(hint, trimmed, true);
    let lang, pending = '';
    const attachAcronyms = mode === 'ja' || hint === 'ja';
    const tokens = attachAcronyms ? value.match(latinWord) ?? [] : value;
    const following = attachAcronyms ? new Map() : null;
    if (following) {
      let next = null;
      for (let i = tokens.length - 1; i >= 0; i--) {
        const token = tokens[i];
        if (acronym.test(token)) {
          if (next) following.set(i, next);
        } else if (japanese.test(token)) next = 'ja';
        else if (letter.test(token)) next = 'vi';
        else if (clauseEnd.test(token)) next = null;
      }
    }
    const annotations = splitBlanks ? null : voiceRomajiAnnotations(value);
    let annotation = annotations?.next().value;
    let index = 0, offset = 0, preceding = null;
    for (const token of tokens) {
      offset += token.length;
      const next = following?.get(index++);
      // Keep a pronunciation annotation intact in the display clip. Only synthesis removes it.
      if (annotation && offset > annotation[0]) {
        pending += token;
        if (offset >= annotation[1]) annotation = annotations.next().value;
        continue;
      }
      const isJapanese = japanese.test(token);
      // Prefer the following text's language for a neutral abbreviation in hinted speech.
      // A comma or colon alone is not a language switch.
      const attached = following && acronym.test(token) && (hint === 'ja'
        ? (next ?? preceding ?? hint) === 'ja'
        : next === 'ja' || preceding === 'ja');
      const kind = isJapanese || attached ? 'ja' : letter.test(token) ? 'vi' : null;
      if (following) {
        if (isJapanese) preceding = 'ja';
        else if (kind === 'vi') preceding = 'vi';
        else if (clauseEnd.test(token)) preceding = null;
      }
      if (kind && lang && kind !== lang) {
        const prefix = pending.match(trailingPrefix)?.[1] ?? (kind === 'ja' ? pending.match(leadingNumber)?.[1] : '') ?? '';
        add(lang, prefix ? pending.slice(0, -prefix.length) : pending);
        pending = prefix;
      }
      if (kind) lang = kind;
      pending += token;
    }
    if (lang) add(lang, pending);
  }
  const breaks = splitBlanks ? synthesisBreaks : arrows;
  for (const part of text.split(/(<(?:ja|vi)>[\s\S]*?<\/(?:ja|vi)>)/gi)) {
    const marked = /^<(ja|vi)>([\s\S]*?)<\/\1>$/i.exec(part);
    const value = marked?.[2] ?? part.replace(/<\/?(?:ja|vi)>/gi, ' ');
    const language = marked?.[1].toLowerCase();
    for (const [index, clause] of value.split(breaks).entries()) {
      if (index % 2) {
        if (!markBoundary(clause === '→' ? 'arrow' : 'blank')) return null;
      } else {
        plain(clause, language);
        if (segments.length > MAX_SEGMENTS) return null;
      }
    }
  }
  if (mixed) return finishCombined() ? segments : null;
  return segments;
}
