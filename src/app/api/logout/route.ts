import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  // Use 303 See Other so browsers follow the redirect with GET (not POST)
  const loginUrl = new URL("/login", request.url)
  const response = NextResponse.redirect(loginUrl, { status: 303 })
  response.cookies.set("auth_token", "", {
    maxAge: 0,
    path: "/",
    httpOnly: true,
  })
  return response
}
