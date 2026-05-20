import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";

interface JwtPayload {
  userId: string;
  name: string;
  avatar: string;
  provider: string;
}

function verifyJwt(token: string): JwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, sigB64] = parts;
    const signingInput = `${headerB64}.${payloadB64}`;
    const expectedSig = createHmac("sha256", JWT_SECRET).update(signingInput).digest("base64url");

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

export async function GET(request: Request): Promise<NextResponse> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const token = cookieHeader.match(/(?:^|;\s*)cybercasino-token=([^;]*)/)?.[1];

  if (!token) {
    return NextResponse.json({ authenticated: false });
  }

  const payload = verifyJwt(token);
  if (!payload) {
    return NextResponse.json({ authenticated: false });
  }

  return NextResponse.json({
    authenticated: true,
    userId: payload.userId,
    name: payload.name,
    avatar: payload.avatar,
    provider: payload.provider,
  });
}