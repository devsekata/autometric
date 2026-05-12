import { NextRequest, NextResponse } from 'next/server'
import { verifyEmailOtp } from '@/lib/auth/verifyOtp'

export async function POST(req: NextRequest) {
  try {
    const { email, otp } = await req.json()

    if (!email || !otp) {
      return NextResponse.json({ error: 'Email and OTP are required.' }, { status: 400 })
    }

    if (otp.length !== 6) {
      return NextResponse.json({ error: 'OTP must be 6 digits.' }, { status: 400 })
    }

    const result = await verifyEmailOtp({ email, otp })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[verify-otp]', err)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
