import { timingSafeEqual } from 'node:crypto';

// Vercel Cron sends "Authorization: Bearer <CRON_SECRET>". Fails closed when no secret is configured.
export const isCronAuthorized = (authorizationHeader, secret) => {
  if (!secret || typeof authorizationHeader !== 'string') return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(authorizationHeader);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};
