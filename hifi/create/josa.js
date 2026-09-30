/* Korean particle after a name: 보리가 / 콩이, 보리를 / 콩을. Non-Hangul endings take the vowel form. */
const PAIRS = { '이/가': ['이', '가'], '을/를': ['을', '를'], '은/는': ['은', '는'], '과/와': ['과', '와'] };

export function josa(word, pair) {
  const [withFinal, withoutFinal] = PAIRS[pair];
  const code = String(word).charCodeAt(String(word).length - 1);
  const hangul = code >= 0xAC00 && code <= 0xD7A3;
  return word + (hangul && (code - 0xAC00) % 28 !== 0 ? withFinal : withoutFinal);
}
