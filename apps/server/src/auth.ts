import { createHmac } from "node:crypto";

const JWT_HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");

export interface JwtPayload {
  userId: string;
  name: string;
  avatar: string;
  provider: string;
}

export function signJwt(payload: JwtPayload, secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payloadB64 = Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + 60 * 60 * 24 * 30 })).toString("base64url");
  const signingInput = `${JWT_HEADER}.${payloadB64}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

export function verifyJwt(token: string, secret: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, sigB64] = parts;
    const signingInput = `${headerB64}.${payloadB64}`;
    const expectedSig = createHmac("sha256", secret).update(signingInput).digest("base64url");

    if (expectedSig !== sigB64) return null;

    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (!payload.userId || !payload.provider) return null;

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;

    return { userId: payload.userId, name: payload.name, avatar: payload.avatar, provider: payload.provider };
  } catch {
    return null;
  }
}