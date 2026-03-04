export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isValidUuid = (value) =>
    typeof value === 'string' && UUID_REGEX.test(value);

// Must start/end with alphanumeric, no consecutive hyphens
export const USERNAME_REGEX = /^[a-z0-9](?:[a-z0-9]*(?:-[a-z0-9]+)*)?$/;

export const isValidUsername = (value) =>
    typeof value === 'string' && USERNAME_REGEX.test(value);

export const RESERVED_USERNAMES = new Set([
    'admin', 'root', 'iskrib', 'iskryb', 'support', 'help',
    'api', 'www', 'null', 'undefined',
]);
