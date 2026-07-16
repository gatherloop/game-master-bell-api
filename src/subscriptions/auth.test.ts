import { describe, expect, it } from "vitest";
import { isValidPasscode } from "./auth.js";

describe("isValidPasscode", () => {
  it("accepts a matching passcode", () => {
    expect(isValidPasscode("secret", "secret")).toBe(true);
  });

  it("rejects a non-matching passcode", () => {
    expect(isValidPasscode("wrong", "secret")).toBe(false);
  });

  it("rejects passcodes of a different length", () => {
    expect(isValidPasscode("s", "secret")).toBe(false);
  });

  it("fails closed when no passcode is configured", () => {
    expect(isValidPasscode("anything", undefined)).toBe(false);
    expect(isValidPasscode("", undefined)).toBe(false);
  });
});
