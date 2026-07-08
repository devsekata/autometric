import { GoogleGenerativeAI } from '@google/generative-ai'

/**
 * Server-side Gemini text generation with model fallback + retry.
 * Key from GEMINI_API_KEY (server env — never exposed to the client).
 */
const MODEL_CHAIN = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash']
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function generateGeminiContent(prompt: string, systemInstruction = ''): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set')
  const genAI = new GoogleGenerativeAI(apiKey)

  let lastErr: unknown = null
  for (const model of MODEL_CHAIN) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const m = genAI.getGenerativeModel({ model, ...(systemInstruction ? { systemInstruction } : {}) })
        const res = await m.generateContent(prompt)
        const text = res.response.text()
        if (text && text.trim()) return text
      } catch (e) {
        lastErr = e
        const msg = e instanceof Error ? e.message : String(e)
        const overloaded = /503|overload|unavailable|rate/i.test(msg)
        const notFound = /404|not found|not supported|does not exist/i.test(msg)
        if (notFound) break            // unavailable model → fall through to the next
        if (!overloaded) break         // non-retryable error → try next model
        if (attempt < 1) await sleep(1000)
      }
    }
  }
  throw new Error(`Gemini generation failed: ${lastErr instanceof Error ? lastErr.message : 'no output'}`)
}
