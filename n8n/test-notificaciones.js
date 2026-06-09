/**
 * Script para probar notificaciones sin usar LIMS ni tocar n8n.
 *
 * Uso:
 *   node n8n/test-notificaciones.js tu-correo@gmail.com
 *
 * Esto envia los 4 tipos de correo (muestra recibida, cambio de estado,
 * completado, resultados validados) al webhook de n8n configurado.
 *
 * Requisito: solo Node.js (no necesita Docker, ni n8n, ni LIMS corriendo).
 */

const WEBHOOK_URL = process.env.N8N_NOTIFICATIONS_WEBHOOK_URL ||
  'https://jmelian.app.n8n.cloud/webhook/lims-notificaciones';

const email = process.argv[2];

if (!email) {
  console.error('ERROR: Debes pasar tu correo como argumento.');
  console.error('  node n8n/test-notificaciones.js tu-correo@gmail.com');
  process.exit(1);
}

if (!email.includes('@')) {
  console.error('ERROR: El correo no parece valido:', email);
  process.exit(1);
}

function buildLayout(body) {
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
    '</div></div></body></html>';
}

const templates = [
  {
    name: 'Muestra recibida',
    payload: {
      to_email: email,
      subject: '[TEST] Muestra DEMO-001 recibida - LIMS',
      html: buildLayout(
        '<h2>Muestra recibida</h2>' +
        '<p>Estimado/a <strong>Cliente Demo</strong>,</p>' +
        '<p>Su muestra ha sido registrada en nuestro sistema:</p>' +
        '<table style="border-collapse:collapse;width:100%;margin:16px 0">' +
        '<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Codigo</td><td style="padding:8px;border:1px solid #ddd">DEMO-001</td></tr>' +
        '<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Especie</td><td style="padding:8px;border:1px solid #ddd">Vitis vinifera var. Cabernet Sauvignon</td></tr>' +
        '<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Fecha</td><td style="padding:8px;border:1px solid #ddd">2026-06-01</td></tr>' +
        '</table><p>Le notificaremos cuando haya actualizaciones.</p>'
      ),
      is_test: true,
      original_email: email,
      template_code: 'sample_received'
    }
  },
  {
    name: 'Estado cambiado',
    payload: {
      to_email: email,
      subject: '[TEST] Estado actualizado: DEMO-001 - LIMS',
      html: buildLayout(
        '<h2>Actualizacion de estado</h2>' +
        '<p>Estimado/a <strong>Cliente Demo</strong>,</p>' +
        '<p>El estado de su muestra ha cambiado:</p>' +
        '<table style="border-collapse:collapse;width:100%;margin:16px 0">' +
        '<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Muestra</td><td style="padding:8px;border:1px solid #ddd">DEMO-001</td></tr>' +
        '<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Estado</td><td style="padding:8px;border:1px solid #ddd;color:#2563eb;font-weight:bold">En procesamiento</td></tr>' +
        '</table>'
      ),
      is_test: true,
      original_email: email,
      template_code: 'sample_status_change'
    }
  },
  {
    name: 'Analisis completado',
    payload: {
      to_email: email,
      subject: '[TEST] Muestra DEMO-001 completada - LIMS',
      html: buildLayout(
        '<h2>Analisis completado</h2>' +
        '<p>Estimado/a <strong>Cliente Demo</strong>,</p>' +
        '<p>El analisis de su muestra ha finalizado:</p>' +
        '<table style="border-collapse:collapse;width:100%;margin:16px 0">' +
        '<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Muestra</td><td style="padding:8px;border:1px solid #ddd">DEMO-001</td></tr>' +
        '<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Especie</td><td style="padding:8px;border:1px solid #ddd">Vitis vinifera</td></tr>' +
        '</table><p>Los resultados estan siendo validados y se los enviaremos a la brevedad.</p>'
      ),
      is_test: true,
      original_email: email,
      template_code: 'sample_completed'
    }
  },
  {
    name: 'Resultados validados',
    payload: {
      to_email: email,
      subject: '[TEST] Resultados validados: DEMO-001 - LIMS',
      html: buildLayout(
        '<h2>Resultados validados</h2>' +
        '<p>Estimado/a <strong>Cliente Demo</strong>,</p>' +
        '<p>Los resultados de su muestra han sido validados y estan disponibles para descarga:</p>' +
        '<table style="border-collapse:collapse;width:100%;margin:16px 0">' +
        '<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Muestra</td><td style="padding:8px;border:1px solid #ddd">DEMO-001</td></tr>' +
        '<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Conclusion</td><td style="padding:8px;border:1px solid #ddd">Phytophthora infestans detectado</td></tr>' +
        '</table>'
      ),
      is_test: true,
      original_email: email,
      template_code: 'results_validated'
    }
  }
];

async function sendTest(index) {
  const test = templates[index];
  process.stdout.write(`  ${test.name}... `);

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(test.payload)
    });

    if (res.ok) {
      console.log('OK');
    } else {
      const text = await res.text();
      console.log('ERROR (' + res.status + '): ' + text.substring(0, 100));
    }
  } catch (err) {
    console.log('FALLO: ' + err.message);
  }
}

async function main() {
  console.log('');
  console.log('========================================');
  console.log('  PRUEBA DE NOTIFICACIONES LIMS');
  console.log('  Destinatario: ' + email);
  console.log('  Webhook: ' + WEBHOOK_URL);
  console.log('========================================');
  console.log('');

  for (let i = 0; i < templates.length; i++) {
    await sendTest(i);
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log('');
  console.log('LISTO. Revisa tu bandeja de entrada (y spam).');
  console.log('Debes recibir 4 correos con el layout de LIMS.');
  console.log('');
}

main();
