import { Prisma } from '@prisma/client';

/**
 * Builds a Prisma filter condition for a field that might contain multiple values
 * separated by commas, colons, or semicolons.
 *
 * @param field The database field name
 * @param value The raw string value from the filter
 * @returns A Prisma condition object or undefined
 */
export const buildMultiValueFilter = (
  field: string,
  value: string | undefined,
): any => {
  if (!value || typeof value !== 'string') return undefined;

  // Split by comma, colon, semicolon, or pipe
  const values = value
    .split(/[,\:;|]/)
    .map((v) => v.trim())
    .filter(Boolean);

  if (values.length === 0) return undefined;

  // Single value - use standard contains
  if (values.length === 1) {
    return {
      [field]: {
        contains: values[0],
        mode: Prisma.QueryMode.insensitive,
      },
    };
  }

  // Multiple values - use OR for this specific field
  return {
    OR: values.map((v) => ({
      [field]: {
        contains: v,
        mode: Prisma.QueryMode.insensitive,
      },
    })),
  };
};
