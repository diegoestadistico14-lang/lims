/**
 * Helper generico para llamar webhooks de n8n.
 * No falla la operacion principal si el webhook falla o no esta configurado.
 *
 * Variables de entorno:
 * - N8N_NOTIFICATIONS_WEBHOOK_URL
 * - N8N_WEBHOOK_USER (Basic Auth)
 * - N8N_WEBHOOK_PASSWORD (Basic Auth)
 * - N8N_WEBHOOK_DISABLE_AUTH=true (opcional) para no enviar Authorization
 */

function buildBasicAuthHeader(username: string, password: string): string {
  const encoded = Buffer.from(`${username}:${password}`, 'utf-8').toString('base64')
  return `Basic ${encoded}`
}

export interface N8nWebhookResult {
  sent: boolean
  error?: string
  responseData?: unknown
}

export async function sendToN8n(
  payload: Record<string, unknown>
): Promise<N8nWebhookResult> {
  const webhookUrl = process.env.N8N_NOTIFICATIONS_WEBHOOK_URL?.trim()
  const webhookUser = process.env.N8N_WEBHOOK_USER?.trim()
  const webhookPassword = process.env.N8N_WEBHOOK_PASSWORD?.trim()
  const disableAuth = process.env.N8N_WEBHOOK_DISABLE_AUTH === 'true'

  if (!webhookUrl) {
    console.warn('[n8nWebhook] N8N_NOTIFICATIONS_WEBHOOK_URL no configurada; webhook omitido')
    return { sent: false, error: 'N8N_NOTIFICATIONS_WEBHOOK_URL no configurada' }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (!disableAuth && webhookUser && webhookPassword) {
    headers['Authorization'] = buildBasicAuthHeader(webhookUser, webhookPassword)
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000) // 30s timeout

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout))

    if (!response.ok) {
      const errorText = await response.text()
      console.error(
        `[n8nWebhook] Webhook responded with ${response.status}:`,
        errorText
      )
      return {
        sent: false,
        error: `Webhook responded with ${response.status}`,
      }
    }

    const data = await response.json().catch(() => null)
    console.log('[n8nWebhook] Webhook enviado OK')
    return { sent: true, responseData: data }
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'AbortError'
    const errorMessage = isTimeout
      ? 'Timeout: n8n no respondió en 30s'
      : error instanceof Error
        ? error.message
        : String(error)
    console.error('[n8nWebhook] Error sending webhook:', errorMessage)
    return {
      sent: false,
      error: errorMessage,
    }
  }
}
