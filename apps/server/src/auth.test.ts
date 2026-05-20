import { test, expect, describe } from "bun:test";
import { signJwt, verifyJwt, type JwtPayload } from "./auth";

const SECRET = "test-secret-key-for-testing";

const payload: JwtPayload = {
  userId: "github:12345",
  name: "testuser",
  avatar: "https://example.com/avatar.png",
  provider: "github",
};

describe("JWT sign/verify", () => {
  test("roundtrip: sign then verify returns original payload", () => {
    const token = signJwt(payload, SECRET);
    const result = verifyJwt(token, SECRET);
    expect(result).toEqual(payload);
  });

  test("rejects tampered token", () => {
    const token = signJwt(payload, SECRET);
    const tampered = token.slice(0, -5) + "XXXXX";
    expect(verifyJwt(tampered, SECRET)).toBeNull();
  });

  test("rejects wrong secret", () => {
    const token = signJwt(payload, SECRET);
    expect(verifyJwt(token, "wrong-secret")).toBeNull();
  });

  test("rejects malformed token", () => {
    expect(verifyJwt("not-a-jwt", SECRET)).toBeNull();
    expect(verifyJwt("", SECRET)).toBeNull();
    expect(verifyJwt("a.b", SECRET)).toBeNull();
  });

  test("rejects token missing userId or provider", () => {
    const badPayload = { name: "test", avatar: "x", provider: "github" } as unknown as JwtPayload;
    const token = signJwt(badPayload, SECRET);
    expect(verifyJwt(token, SECRET)).toBeNull();
  });

  test("rejects expired token", () => {
    // Manually craft an expired token
    const now = Math.floor(Date.now() / 1000);
    const expiredPayload = { ...payload, iat: now - 1000, exp: now - 1 };
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(expiredPayload)).toString("base64url");
    const crypto = require("node:crypto");
    const sig = crypto.createHmac("sha256", SECRET).update(`${header}.${body}`).digest("base64url");
    const token = `${header}.${body}.${sig}`;
    expect(verifyJwt(token, SECRET)).toBeNull();
  });

  test("valid token includes correct userId and provider", () => {
    const token = signJwt(payload, SECRET);
    const result = verifyJwt(token, SECRET);
    expect(result?.userId).toBe("github:12345");
    expect(result?.provider).toBe("github");
  });
});
