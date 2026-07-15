export function calendarSearchMatchQuery(input: string): string | null {
  const tokens = input
    .normalize('NFKC')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}@._+-]+/gu)
    ?.map(token => token.slice(0, 64))
    .filter(Boolean)
    .slice(0, 8) || [];
  if (tokens.length === 0) return null;
  return tokens.map(token => `"${token.replaceAll('"', '""')}"*`).join(' AND ');
}
