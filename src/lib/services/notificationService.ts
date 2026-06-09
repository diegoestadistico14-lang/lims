import { createClient } from '@/lib/supabase/server'
import { sendToN8n } from './n8nWebhook'

const TEST_RECIPIENT = process.env.N8N_TEST_RECIPIENT?.trim() || null

type NotificationChannel = 'email'

interface EnqueueParams {
  userId: string
  email: string
  templateCode: string
  payload: Record<string, unknown>
  channel?: NotificationChannel
}

export async function enqueueNotification(params: EnqueueParams) {
  const supabase = await createClient()

  const { error } = await supabase.from('notifications').insert({
    channel: params.channel || 'email',
    to_ref: { email: params.email, user_id: params.userId },
    template_code: params.templateCode,
    payload: params.payload,
    status: 'queued'
  })

  if (error) {
    console.error('Error enqueuing notification:', error)
    return
  }

  // Build email and send via n8n (fire-and-forget)
  const { subject, html } = buildEmail(params.templateCode, params.payload)

  const isTestMode = !!(TEST_RECIPIENT && TEST_RECIPIENT !== params.email)
  const toEmail = isTestMode ? TEST_RECIPIENT : params.email

  if (isTestMode) {
    const banner = '<div style="background:#fef3c7;border:1px solid #f59e0b;padding:10px;margin-bottom:16px;border-radius:6px;font-size:13px;color:#92400e"><strong>MODO PRUEBA</strong> — Este correo iba dirigido a: ' + escHtml(params.email) + '</div>'
    const finalHtml = html.replace('<div style="padding:24px">', '<div style="padding:24px">' + banner)
    sendFinal({
      email: params.email,
      templateCode: params.templateCode,
      toEmail,
      isTestMode,
      subject: '[TEST] ' + subject,
      html: finalHtml
    }).catch(err => console.error('Async n8n send failed:', err))
  } else {
    sendFinal({
      email: params.email,
      templateCode: params.templateCode,
      toEmail,
      isTestMode,
      subject,
      html
    }).catch(err => console.error('Async n8n send failed:', err))
  }
}

async function sendFinal(params: {
  email: string
  templateCode: string
  toEmail: string
  isTestMode: boolean
  subject: string
  html: string
}) {
  const { email, templateCode, toEmail, isTestMode, subject, html } = params

  const result = await sendToN8n({
    to_email: toEmail,
    subject,
    html,
    is_test: isTestMode,
    original_email: email,
    template_code: templateCode
  })

  const supabase = await createClient()
  if (result.sent) {
    await supabase.from('notifications')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('to_ref->>email', email)
      .eq('template_code', templateCode)
      .eq('status', 'queued')
      .order('created_at', { ascending: false })
      .limit(1)
  } else {
    await supabase.from('notifications')
      .update({ status: 'error', error: result.error || 'Unknown error' })
      .eq('to_ref->>email', email)
      .eq('template_code', templateCode)
      .eq('status', 'queued')
      .order('created_at', { ascending: false })
      .limit(1)
  }
}

function escHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function getSubject(templateCode: string, sampleCode: string): string {
  const code = sampleCode || ''
  switch (templateCode) {
    case 'sample_received': return 'Muestra ' + code + ' recibida - LIMS'
    case 'sample_status_change': return 'Estado actualizado: ' + code + ' - LIMS'
    case 'sample_completed': return 'Muestra ' + code + ' completada - LIMS'
    case 'results_ready': return 'Resultados disponibles: ' + code + ' - LIMS'
    case 'results_validated': return 'Resultados validados: ' + code + ' - LIMS'
    default: return 'Notificacion LIMS - ' + code
  }
}

function buildLayout(body: string): string {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head>' +
    '<body style="font-family:Arial,sans-serif;background:#f9fafb;margin:0;padding:24px">' +
    '<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">' +
    '<div style="background:#16a34a;padding:20px;color:#fff">' +
    '<h1 style="margin:0;font-size:20px">LIMS</h1>' +
    '<p style="margin:4px 0 0;font-size:14px;opacity:0.9">Sistema de Gestion de Laboratorio</p>' +
    '</div>' +
    '<div style="padding:24px">' + body + '</div>' +
    '<div style="background:#f3f4f6;padding:16px;text-align:center;font-size:12px;color:#6b7280">' +
    'Este es un correo automatico de LIMS. No responda a este mensaje.' +
    '</div></div></body></html>'
}

function buildEmail(templateCode: string, p: Record<string, unknown>): { subject: string; html: string } {
  const code = escHtml((p.sample_code as string) || '')
  const client = escHtml((p.client_name as string) || '')
  const species = escHtml((p.species as string) || '')
  const variety = escHtml((p.variety as string) || '')
  const receivedDate = escHtml((p.received_date as string) || '-')
  const statusLabel = escHtml(((p.status_label || p.new_status) as string) || '')
  const diagnosis = escHtml((p.diagnosis as string) || 'Ver informe adjunto')
  const pathogen = escHtml((p.pathogen as string) || 'No detectado')
  const conclusion = escHtml((p.conclusion as string) || 'Ver informe')
  const recommendations = p.recommendations
    ? '<div style="background:#f0fdf4;padding:12px;border-radius:8px;margin-top:12px"><strong>Recomendaciones:</strong><br>' + escHtml(p.recommendations as string) + '</div>'
    : ''

  let body = ''
  switch (templateCode) {
    case 'sample_received':
      body = '<h2>Muestra recibida</h2>' +
        '<p>Estimado/a <strong>' + client + '</strong>,</p>' +
        '<p>Su muestra ha sido registrada en nuestro sistema:</p>' +
        '<table style="border-collapse:collapse;width:100%;margin:16px 0">' +
        '<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Codigo</td><td style="padding:8px;border:1px solid #ddd">' + code + '</td></tr>' +
        '<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Especie</td><td style="padding:8px;border:1px solid #ddd">' + species + (variety ? ' var. ' + variety : '') + '</td></tr>' +
        '<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Fecha</td><td style="padding:8px;border:1px solid #ddd">' + receivedDate + '</td></tr>' +
        '</table><p>Le notificaremos cuando haya actualizaciones.</p>'
      break
    case 'sample_status_change':
      body = '<h2>Actualizacion de estado</h2>' +
        '<p>Estimado/a <strong>' + client + '</strong>,</p>' +
        '<p>El estado de su muestra ha cambiado:</p>' +
        '<table style="border-collapse:collapse;width:100%;margin:16px 0">' +
        '<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Muestra</td><td style="padding:8px;border:1px solid #ddd">' + code + '</td></tr>' +
        '<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Estado</td><td style="padding:8px;border:1px solid #ddd;color:#2563eb;font-weight:bold">' + statusLabel + '</td></tr>' +
        '</table>'
      break
    case 'sample_completed':
      body = '<h2>Analisis completado</h2>' +
        '<p>Estimado/a <strong>' + client + '</strong>,</p>' +
        '<p>El analisis de su muestra ha finalizado:</p>' +
        '<table style="border-collapse:collapse;width:100%;margin:16px 0">' +
        '<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Muestra</td><td style="padding:8px;border:1px solid #ddd">' + code + '</td></tr>' +
        '<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Especie</td><td style="padding:8px;border:1px solid #ddd">' + species + '</td></tr>' +
        '</table><p>Los resultados estan siendo validados y se los enviaremos a la brevedad.</p>'
      break
    case 'results_ready':
      body = '<h2>Resultados disponibles</h2>' +
        '<p>Estimado/a <strong>' + client + '</strong>,</p>' +
        '<p>Los resultados de su muestra estan listos:</p>' +
        '<table style="border-collapse:collapse;width:100%;margin:16px 0">' +
        '<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Muestra</td><td style="padding:8px;border:1px solid #ddd">' + code + '</td></tr>' +
        '<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Diagnostico</td><td style="padding:8px;border:1px solid #ddd">' + diagnosis + '</td></tr>' +
        '<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Patogeno</td><td style="padding:8px;border:1px solid #ddd">' + pathogen + '</td></tr>' +
        '</table><p>Ingrese al sistema para ver el informe completo.</p>' + recommendations
      break
    case 'results_validated':
      body = '<h2>Resultados validados</h2>' +
        '<p>Estimado/a <strong>' + client + '</strong>,</p>' +
        '<p>Los resultados de su muestra han sido validados y estan disponibles para descarga:</p>' +
        '<table style="border-collapse:collapse;width:100%;margin:16px 0">' +
        '<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Muestra</td><td style="padding:8px;border:1px solid #ddd">' + code + '</td></tr>' +
        '<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Conclusion</td><td style="padding:8px;border:1px solid #ddd">' + conclusion + '</td></tr>' +
        '</table>'
      break
    default:
      body = '<p>Notificacion de LIMS para muestra ' + code + '.</p>'
  }

  return {
    subject: getSubject(templateCode, code),
    html: buildLayout(body)
  }
}

const STATUS_LABELS: Record<string, string> = {
  received: 'Recibida',
  processing: 'En procesamiento',
  microscopy: 'Microscopia',
  isolation: 'Aislamiento',
  identification: 'Identificacion',
  molecular_analysis: 'Analisis molecular',
  validation: 'Validacion',
  completed: 'Completada'
}

export async function notifyStatusChange(params: {
  sampleId: string
  sampleCode: string
  newStatus: string
  clientEmail: string
  clientName: string
  species: string
  variety?: string
}) {
  const label = STATUS_LABELS[params.newStatus] || params.newStatus

  await enqueueNotification({
    userId: '',
    email: params.clientEmail,
    templateCode: params.newStatus === 'completed' ? 'sample_completed' : 'sample_status_change',
    payload: {
      sample_id: params.sampleId,
      sample_code: params.sampleCode,
      client_name: params.clientName,
      species: params.species,
      variety: params.variety || '',
      new_status: params.newStatus,
      status_label: label
    }
  })
}

export async function notifyResultsReady(params: {
  sampleId: string
  sampleCode: string
  clientEmail: string
  clientName: string
  species: string
  diagnosis?: string
  pathogen?: string
  recommendations?: string
  conclusion?: string
}) {
  await enqueueNotification({
    userId: '',
    email: params.clientEmail,
    templateCode: 'results_validated',
    payload: {
      sample_id: params.sampleId,
      sample_code: params.sampleCode,
      client_name: params.clientName,
      species: params.species,
      diagnosis: params.diagnosis || '',
      pathogen: params.pathogen || '',
      recommendations: params.recommendations || '',
      conclusion: params.conclusion || ''
    }
  })
}
