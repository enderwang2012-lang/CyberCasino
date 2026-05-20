import { NextResponse } from "next/server";

export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("cybercasino-token", "", { maxAge: 0, path: "/" });
  return response;
}