/**
 * Utility functions for string normalization
 */

/**
 * Convert a string to Title Case
 * Examples:
 * - "india" -> "India"
 * - "new york" -> "New York"
 * - "UNITED STATES" -> "United States"
 */
export function toTitleCase(str: string | null | undefined): string {
  if (!str) return '';

  return str
    .toLowerCase()
    .split(' ')
    .map((word) => {
      if (word.length === 0) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/**
 * Normalize an object's string fields to Title Case
 * @param obj - Object to normalize
 * @param fieldsToNormalize - Array of field names to apply Title Case
 */
export function normalizeTitleCase<T extends Record<string, any>>(
  obj: T,
  fieldsToNormalize: (keyof T)[],
): T {
  const normalized = { ...obj };

  for (const field of fieldsToNormalize) {
    const value = normalized[field];
    if (typeof value === 'string') {
      normalized[field] = toTitleCase(value) as any;
    }
  }

  return normalized;
}
