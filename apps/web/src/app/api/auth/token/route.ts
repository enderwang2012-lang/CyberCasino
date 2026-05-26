import { NextResponse } from "next/server";

export async function GET(request: Request): Promise<NextResponse> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const token = cookieHeader.match(/(?:^|;\s*)cybercasino-token=([^;]*)/)?.[1];

  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  return NextResponse.json({ token });
}
