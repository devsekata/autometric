import bcrypt from 'bcryptjs'
import crypto from 'crypto'

export function generateOtp(): string {
  return crypto.randomInt(100000, 999999).toString()
}

export async function hashOtp(otp: string): Promise<string> {
  return bcrypt.hash(otp, 10)
}

export async function verifyOtp(otp: string, hash: string): Promise<boolean> {
  return bcrypt.compare(otp, hash)
}
