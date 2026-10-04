/**
 * The most plate-like string in text read from a photo, or '' when nothing
 * fits. A plate is 4-10 letters and digits, with at least one of each and no
 * five letters in a row; spaces and punctuation inside it ("KDA 101A",
 * "AB-12 CD") are dropped. The guard always sees and can correct the result
 * before it is checked.
 */
export function extractPlate(text: string): string {
  const candidates: string[] = [];
  for (const line of text.toUpperCase().split(/\r?\n/)) {
    // The whole line, neighbouring pairs (plates are often split by a space,
    // with other words beside them), then single words.
    const words = line.split(/[^A-Z0-9]+/).filter(Boolean);
    const pairs = words.slice(1).map((word, i) => words[i] + word);
    for (const option of [words.join(''), ...pairs, ...words]) {
      if (
        /^[A-Z0-9]{4,10}$/.test(option) &&
        /[A-Z]/.test(option) &&
        /[0-9]/.test(option) &&
        // Plates rarely run five letters together; a word glued on does ("777XKENYA").
        !/[A-Z]{5}/.test(option)
      ) {
        candidates.push(option);
      }
    }
  }
  // Longest wins: a full plate beats a fragment of it.
  return candidates.sort((a, b) => b.length - a.length)[0] ?? '';
}
