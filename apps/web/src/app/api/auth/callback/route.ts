import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";

const JWT_HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");

function signJwt(payload: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const payloadB64 = Buffer.from(JSON.stringify({ ...payload, iat: now, exp: now + 60 * 60 * 24 * 30 })).toString("base64url");
  const signingInput = `${JWT_HEADER}.${payloadB64}`;
  const signature = createHmac("sha256", JWT_SECRET).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

async function exchangeGithubCode(code: string): Promise<{ accessToken: string } | null> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  if (!res.ok) {
    console.error("[github] token exchange failed:", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  if (!data.access_token) {
    console.error("[github] no access_token in response:", data);
    return null;
  }
  return { accessToken: data.access_token };
}

async function getGithubUser(accessToken: string): Promise<{ id: number; login: string; avatar_url: string } | null> {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "CyberCasino" },
  });
  if (!res.ok) return null;
  return res.json();
}

async function exchangeGoogleCode(code: string): Promise<{ accessToken: string } | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      code,
      grant_type: "authorization_code",
      redirect_uri: `${APP_URL}/api/auth/callback?provider=google`,
    }),
  });
  if (!res.ok) {
    console.error("[google] token exchange failed:", res.status, await res.text());
    return null;
  }
  const data = await res.json();
  if (!data.access_token) {
    console.error("[google] no access_token in response:", data);
    return null;
  }
  return { accessToken: data.access_token };
}

async function getGoogleUser(accessToken: string): Promise<{ sub: string; name: string; picture: string } | null> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider");
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  // Validate state (CSRF protection)
  const stateCookie = request.headers.get("cookie")?.match(/(?:^|;\s*)oauth-state=([^;]*)/)?.[1];
  if (!state || state !== stateCookie) {
    return NextResponse.json({ error: "Invalid state" }, { status: 400 });
  }

  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  if (provider !== "github" && provider !== "google") {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }

  // Exchange code for user info
  let userId: string;
  let name: string;
  let avatar: string;

  if (provider === "github") {
    const tokenResult = await exchangeGithubCode(code);
    if (!tokenResult) return NextResponse.json({ error: "Failed to exchange code" }, { status: 500 });

    const user = await getGithubUser(tokenResult.accessToken);
    if (!user) return NextResponse.json({ error: "Failed to get user" }, { status: 500 });

    userId = `github:${user.id}`;
    name = user.login;
    avatar = user.avatar_url;
  } else {
    const tokenResult = await exchangeGoogleCode(code);
    if (!tokenResult) return NextResponse.json({ error: "Failed to exchange code" }, { status: 500 });

    const user = await getGoogleUser(tokenResult.accessToken);
    if (!user) return NextResponse.json({ error: "Failed to get user" }, { status: 500 });

    userId = `google:${user.sub}`;
    name = user.name;
    avatar = user.picture;
  }

  // Sign JWT and set cookie
  const token = signJwt({ userId, name, avatar, provider });
  const response = NextResponse.redirect(APP_URL);

  response.cookies.set("oauth-state", "", { maxAge: 0, path: "/" });
  response.cookies.set("cybercasino-token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return response;
}