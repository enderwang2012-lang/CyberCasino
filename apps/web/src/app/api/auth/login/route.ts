import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? "";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

function buildGithubUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: `${APP_URL}/api/auth/callback?provider=github`,
    scope: "read:user",
    state,
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

function buildGoogleUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${APP_URL}/api/auth/callback?provider=google`,
    response_type: "code",
    scope: "openid profile email",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider");

  if (provider !== "github" && provider !== "google") {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }

  const state = randomBytes(16).toString("hex");
  const url = provider === "github" ? buildGithubUrl(state) : buildGoogleUrl(state);

  const response = NextResponse.redirect(url);
  response.cookies.set("oauth-state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 300,
  });

  return response;
}