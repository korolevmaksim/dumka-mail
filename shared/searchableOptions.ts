export function filterSearchableOptions(options: string[], query: string): string[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return options;
  return options.filter(option => option.toLowerCase().includes(normalizedQuery));
}
