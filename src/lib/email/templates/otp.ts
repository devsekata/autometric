export function otpEmailTemplate(
  name: string,
  otp: string,
  variant: 'register' | 'reset' = 'register'
): { subject: string; html: string } {
  const isReset = variant === 'reset'
  return {
    subject: isReset ? 'Reset your Kepiai password' : 'Your Kepiai verification code',
    html: `
      <!DOCTYPE html>
      <html>
        <body style="margin:0;padding:0;background:#f0f1f8;font-family:'Inter',Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;">
            <tr>
              <td align="center">
                <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;">

                  <!-- Header -->
                  <tr>
                    <td style="background:#1a1f71;padding:32px 40px;">
                      <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">
                        Kepiai
                      </p>
                    </td>
                  </tr>

                  <!-- Body -->
                  <tr>
                    <td style="padding:40px;">
                      <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#0f1117;">
                        Hi, ${name} 👋
                      </p>
                      <p style="margin:0 0 32px;font-size:15px;color:#6b7280;line-height:1.6;">
                        ${isReset
                          ? 'Use the code below to reset your Kepiai password. This code expires in <strong>10 minutes</strong>.'
                          : 'Use the code below to verify your email address. This code expires in <strong>10 minutes</strong>.'
                        }
                      </p>

                      <!-- OTP Box -->
                      <div style="text-align:center;margin-bottom:32px;">
                        <span style="display:inline-block;background:#f0f1f8;border-radius:12px;padding:20px 40px;font-size:36px;font-weight:800;letter-spacing:12px;color:#1a1f71;">
                          ${otp}
                        </span>
                      </div>

                      <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">
                        If you didn't request this, you can safely ignore this email.
                        Someone may have typed your email address by mistake.
                      </p>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="padding:24px 40px;border-top:1px solid #f3f4f6;">
                      <p style="margin:0;font-size:12px;color:#9ca3af;">
                        © ${new Date().getFullYear()} Kepiai. All rights reserved.
                      </p>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `,
  }
}
