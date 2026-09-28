import { NextRequest, NextResponse } from 'next/server'
import { forgotPassword } from '@/lib/auth/forgotPassword'

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()

    if (!email) {
      return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
    }

    const result = await forgotPassword(email)
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status ?? 400 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[forgot-password]', err)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
