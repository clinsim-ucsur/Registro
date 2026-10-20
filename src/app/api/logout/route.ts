import { NextResponse } from "next/server"

export async function POST() {
  const response = NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_BASE_URL || "https://registro-cceeu4uuk-pass-18e6.vercel.app/login"))
  response.cookies.delete("auth_token")
  return response
}
