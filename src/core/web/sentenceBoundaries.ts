/** Splits text after sentence punctuation followed by whitespace, preserving punctuation. */
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let start = 0;

  for (let index = 0; index < text.length - 1; index += 1) {
    if (!isSentencePunctuation(text[index]) || !isWhitespace(text[index + 1])) continue;

    const sentence = text.slice(start, index + 1).trim();
    if (sentence) sentences.push(sentence);
    while (index + 1 < text.length && isWhitespace(text[index + 1])) index += 1;
    start = index + 1;
  }

  const remainder = text.slice(start).trim();
  if (remainder) sentences.push(remainder);
  return sentences;
}

function isSentencePunctuation(character: string | undefined): boolean {
  return character === "." || character === "!" || character === "?";
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/.test(character);
}
