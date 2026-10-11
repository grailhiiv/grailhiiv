/** Format UI labels without changing the values stored in workspace records. */
export function titleLabel(value: string) {
  const words = [...value.matchAll(/[A-Za-z][A-Za-z0-9]*(?:['’][A-Za-z0-9]+)*/g)];
  return value.replace(/[A-Za-z][A-Za-z0-9]*(?:['’][A-Za-z0-9]+)*/g, (word, offset: number) => {
    if (word === "n8n") return word;
    const index = words.findIndex(match => match.index === offset);
    if (index > 0 && index < words.length - 1 && /^(a|an|and|as|at|by|for|in|of|on|or|the|to|with)$/i.test(word))
      return word.toLowerCase();
    return word[0].toUpperCase() + word.slice(1);
  });
}
