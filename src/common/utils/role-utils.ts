const ADMIN_ROLE_KEYS = new Set(['ADMIN', 'SUPER_ADMIN']);

export const normalizeRole = (role?: string | null): string => {
  if (!role) return '';
  return role.toString().trim().replace(/\s+/g, '_').toUpperCase();
};

export const isAdminRole = (role?: string | null): boolean => {
  return ADMIN_ROLE_KEYS.has(normalizeRole(role));
};
