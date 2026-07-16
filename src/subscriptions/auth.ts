import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time passcode check. `undefined` expected (staff passcode not
 * configured) always fails closed rather than accepting anything.
 */
export function isValidPasscode(provided: string, expected: string | undefined): boolean {
  if (!expected) {
    return false;
  }
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(providedBuf, expectedBuf);
}
