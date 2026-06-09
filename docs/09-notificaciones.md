# 09 — Notificaciones por Correo

> Ultima actualizacion: 2026-05-28.

## Proposito

Este documento describe el sistema de notificaciones por correo electronico del LIMS, basado en **n8n** como orquestador de envio. Cubre los templates de email, los puntos de disparo en las rutas API, las preferencias de usuario, y la configuracion de entorno necesaria.

## Documentos relacionados

| Doc | Relacion |
|---|---|
| `01-arquitectura.md` | Servicio `notificationService.ts`, webhook n8n |
| `03-api-routes.md` | Rutas que disparan notificaciones |
| `04-base-de-datos.md` | Tablas `notifications` y `notification_preferences` |
| `08-deploy-entorno.md` | Variables de entorno, docker-compose n8n |

## Stack de notificaciones

- **Orquestador**: n8n (webhook + workflow)
- **Modulo LIMS**: `src/lib/services/notificationService.ts` + `n8nWebhook.ts`
- **Workflow n8n**: `n8n/workflows/notificaciones-email.json`
- **Endpoint de preferencias**: `GET/PUT /api/notifications/preferences`
- **Tablas**: `notifications` (cola/bitacora), `notification_preferences` (preferencias por usuario)

## Despliegue de n8n

n8n se despliega via Docker junto al proyecto:

```bash
# Local (desarrollo)
docker-compose up -d
# n8n disponible en http://localhost:5678
```

El `docker-compose.yml` incluye:
- Imagen `n8nio/n8n:latest`
- Puerto `5678`
- Volumen persistente para datos y workflows
- Variables SMTP configurables

### Importar workflow

1. Abrir `http://localhost:5678`
2. Crear cuenta (primer inicio)
3. Settings → Import → seleccionar `n8n/workflows/notificaciones-email.json`
4. Configurar credenciales SMTP en el nodo "Enviar correo"
5. Activar el workflow

## Variables de entorno

```bash
# n8n — Webhook de notificaciones
N8N_NOTIFICATIONS_WEBHOOK_URL=http://localhost:5678/webhook/lims-notificaciones  # URL del webhook
N8N_WEBHOOK_USER=admin                # Basic Auth user (opcional)
N8N_WEBHOOK_PASSWORD=xxxxx            # Basic Auth password (opcional)
N8N_WEBHOOK_DISABLE_AUTH=true         # Deshabilitar auth (solo desarrollo)
N8N_TEST_RECIPIENT=test@midominio.com # Redirige TODOS los correos a esta direccion (solo desarrollo)
```

## Flujo de envio

```
Ruta API (sample creado, status cambiado, resultado validado)
  → notifyStatusChange() / notifyResultsReady()
    → enqueueNotification()
      1. INSERT en tabla notifications (status: 'queued')
      2. sendViaN8n() — fire-and-forget
         → POST al webhook de n8n
         → n8n: construir HTML → enviar via SMTP → responder { success: true }
         → UPDATE notifications (status: 'sent' o 'error')
```

El envio es asincrono (no bloquea la respuesta HTTP). Si falla, el error se registra en `notifications.error` y en `console.error`.

## Puntos de disparo

### 1. Muestra recibida

- **Ruta**: `POST /api/samples`
- **Funcion**: `enqueueNotification()` directo
- **Template**: `sample_received`
- **Condicion**: el cliente tiene `contact_email`

### 2. Cambio de estado de muestra

- **Rutas**: `PUT /api/samples/[id]`, `PATCH /api/samples/[id]`
- **Funcion**: `notifyStatusChange()`
- **Templates**: `sample_status_change` (normal), `sample_completed` (si el nuevo estado es `completed`)
- **Condicion**: el cliente tiene `contact_email` y el campo `status` cambio

### 3. Resultados validados

- **Rutas**: `PUT /api/results/[id]` (cuando `status === 'validated'`), `PATCH /api/results/[id]/validate`
- **Funcion**: `notifyResultsReady()`
- **Template**: `results_validated`
- **Condicion**: el cliente tiene `contact_email`

### 4. Resultados listos (template disponible, no conectado aun)

- **Template**: `results_ready` — definido en el workflow de n8n pero sin punto de disparo automatico
- **Uso previsto**: cuando un resultado pasa a `completed` pero no esta validado

## Templates de email

Los templates residen en el Code node del workflow de n8n (`Construir email`). Son los mismos 5 templates originales con el layout comun LIMS.

| Codigo | Asunto | Gatillado por |
|---|---|---|
| `sample_received` | "Muestra {codigo} recibida - LIMS" | Creacion de muestra |
| `sample_status_change` | "Estado actualizado: {codigo} - LIMS" | Cambio de estado (cualquiera excepto `completed`) |
| `sample_completed` | "Muestra {codigo} completada - LIMS" | Estado cambia a `completed` |
| `results_ready` | "Resultados disponibles: {codigo} - LIMS" | (no conectado) |
| `results_validated` | "Resultados validados: {codigo} - LIMS" | Validacion de resultado |

Layout comun:
- Header verde con logo "LIMS"
- Cuerpo con tabla de datos (codigo muestra, especie, diagnostico, etc.)
- Footer: "Este es un correo automatico de LIMS. No responda a este mensaje."
- Diseno responsive, max-width 600px

## Modo prueba

Si la variable `N8N_TEST_RECIPIENT` esta definida en el entorno de LIMS, el servicio envia `is_test: true` en el payload al webhook de n8n. El workflow de n8n entonces:
1. Redirige el email a la direccion configurada en el nodo SMTP
2. Agrega banner amarillo `[MODO PRUEBA]` indicando el destinatario original
3. Prefija el subject con `[TEST]`

Esto permite verificar el contenido de los correos sin enviarlos a clientes reales.

## Preferencias de usuario

**Endpoint**: `GET/PUT /api/notifications/preferences`

Estructura de `notification_preferences`:

| Campo | Tipo | Default | Descripcion |
|---|---|---|---|
| `user_id` | UUID | — | PK, usuario autenticado |
| `email_notifications` | boolean | `true` | Master switch |
| `new_results` | boolean | `true` | Notificar nuevos resultados |
| `sla_reminders` | boolean | `false` | Recordatorios SLA |
| `sample_status_changes` | boolean | `true` | Cambios de estado |
| `updated_at` | timestamptz | auto | Ultima actualizacion |

**Nota**: Las preferencias se consultan en el frontend pero el envio actual **no las verifica** — siempre envia si el cliente tiene `contact_email`. La verificacion de preferencias debe implementarse en el servicio antes de llamar al webhook.

## Estructura de la tabla `notifications`

Bitacora/cola de envios. Cada registro representa un intento de notificacion:

| Campo | Tipo | Descripcion |
|---|---|---|
| `id` | UUID | PK |
| `channel` | text | `'email'` |
| `to_ref` | jsonb | `{ email, user_id }` |
| `template_code` | text | Codigo del template usado |
| `payload` | jsonb | Datos del template (sample_code, client_name, etc.) |
| `status` | text | `'queued'` → `'sent'` / `'error'` |
| `sent_at` | timestamptz | Fecha de envio exitoso |
| `error` | text | Mensaje de error si `status = 'error'` |
| `created_at` | timestamptz | Fecha de encolamiento |

## Modificaciones en rutas existentes

Para habilitar el envio de notificaciones, se modificaron estas rutas:

### `src/app/api/samples/route.ts` (POST)
- Agrega query a `clients` para obtener `contact_email` y `name` del cliente
- Dispara `enqueueNotification()` con template `sample_received`

### `src/app/api/samples/[id]/route.ts` (PUT, PATCH)
- Agrega `contact_email` al select de `clients`
- Dispara `notifyStatusChange()` al cambiar el campo `status`
- Detecta si el nuevo estado es `completed` para usar el template correcto

### `src/app/api/results/[id]/route.ts` (PUT)
- Agrega `contact_email` al select de `clients` anidado bajo `samples`
- Dispara `notifyResultsReady()` solo cuando `status` cambia a `'validated'` y antes no lo estaba

### `src/app/api/results/[id]/validate/route.ts` (PATCH)
- Agrega `contact_email` al select
- Dispara `notifyResultsReady()` al validar

Todas las llamadas usan `.catch(err => console.error(...))` — fire-and-forget, no bloquean la respuesta.

## Funciones del servicio

### `enqueueNotification(params)`
Registra en la tabla `notifications` y dispara envio inmediato via webhook n8n.

### `sendViaN8n(params)`
Envia el payload al webhook de n8n y actualiza el status (`sent` o `error`). Si `N8N_TEST_RECIPIENT` esta configurado, marca `is_test: true` en el payload.

### `notifyStatusChange(params)`
Wrapper que traduce el codigo de estado (`received`, `completed`, etc.) a etiqueta en espanol y elige el template correcto.

### `notifyResultsReady(params)`
Wrapper para el template `results_validated`.

## Reglas

1. **Siempre fire-and-forget** — las notificaciones nunca deben bloquear la respuesta HTTP
2. **No enviar si no hay `contact_email`** — verificar antes de llamar a las funciones de notificacion
3. **Usar `N8N_TEST_RECIPIENT` en desarrollo** — nunca enviar correos de prueba a clientes reales
4. **No exponer URL de webhook al cliente** — solo se usa en el servidor (server component / API route)
5. **Verificar preferencias antes de enviar** (pendiente) — actualmente el sistema envia sin consultar `notification_preferences`
6. **Todo correo debe incluir el footer de "no responder"** — lo garantiza el Code node en n8n
7. **Etiquetas de estado en espanol** — usar `STATUS_LABELS` para traducir estados internos
8. **El workflow de n8n debe estar activado** — si esta pausado, los webhooks responden 404

## Guia para el revisor del PR

### Forma facil (recomendada) — abre LIMS, crea una muestra, recibe el correo

**No necesitas Docker, ni configurar SMTP, ni tocar n8n.**

1. Pidele al autor del PR el archivo `.env.local` con las variables de entorno
2. Colocalo en la raiz del proyecto
3. Ejecuta:
   ```bash
   npm install
   npm run dev
   ```
4. Abre `http://localhost:3000` e inicia sesion con la cuenta de pruebas:
   - **Usuario**: `jmelian@lims.com`
   - **Contrasena**: `test123`
5. Anda a **Clientes** → busca **Jmelian** → editalo → cambia el `contact_email` a **tu correo personal**
6. Anda a **Muestras** → busca **DEMO-026** (o cualquier DEMO) → editala → cambia el **Estado** a cualquier otro valor → guarda
7. Revisa tu bandeja de entrada (y spam). Debes recibir un correo con el layout de LIMS.

**Para probar los 4 templates**, repite el paso 6 con estos cambios:
- Cambiar estado cualquiera → `sample_status_change`
- Cambiar estado a **Completada** → `sample_completed`
- Ir a una muestra con resultados y validarlo → `results_validated`

Tambien podes probar creando una muestra nueva (`POST /api/samples`) → `sample_received`.

### Forma completa — probar integracion real con LIMS

Usa este metodo si necesitas verificar el flujo completo (accion en LIMS → notificacion → correo).

1. **n8n funcionando**: local via Docker (`docker-compose up -d`) o una instancia cloud (n8n.cloud)
2. **Credenciales SMTP configuradas en n8n**: el nodo "Enviar por Gmail" (o SMTP) debe tener credenciales validas
3. **Workflow importado en n8n**: importar `n8n/workflows/notificaciones-email.json` desde Settings → Import
4. **Webhook activo**: el workflow debe estar activado (toggle "Active" en ON)
5. **Variables de entorno en `.env.local`**:
   ```bash
   N8N_NOTIFICATIONS_WEBHOOK_URL=<url-del-webhook>   # ej. http://localhost:5678/webhook/lims-notificaciones
   N8N_WEBHOOK_DISABLE_AUTH=true                      # desactivar auth en desarrollo local
   N8N_TEST_RECIPIENT=                                 # VACIO para envio a clientes reales
   ```
6. **Servidor LIMS corriendo**: `npm run dev`

### Como probar

1. **Abrir LIMS** en `http://localhost:3000`
2. **Iniciar sesion** con una cuenta que tenga muestras
3. **Probar cada trigger**:
   - **Muestra recibida**: crear una nueva muestra (el cliente debe tener `contact_email`)
   - **Cambio de estado**: editar una muestra existente y cambiar su `status`
   - **Resultado validado**: ir a una muestra con resultados y validar un resultado
4. **Verificar en n8n**: abrir el workflow y revisar la pestana "Executions" — cada notificacion debe mostrar status "Success"
5. **Verificar en Gmail**: el destinatario (cliente) debe recibir el correo con el template correcto

### Como verificar que SI funciona

- **En n8n**: las ejecuciones aparecen con icono verde ✓
- **En BD**: `SELECT * FROM notifications ORDER BY created_at DESC LIMIT 5;` → `status = 'sent'`
- **En Gmail**: el cliente recibe el correo con el layout LIMS (header verde, tabla de datos, footer gris)

### Checklist de verificacion

- [ ] `POST /api/samples` → `sample_received` → llega correo al cliente
- [ ] `PATCH /api/samples/[id]` con cambio de `status` → `sample_status_change` → llega correo
- [ ] Cambiar status a `completed` → `sample_completed` → llega correo
- [ ] `PATCH /api/results/[id]/validate` → `results_validated` → llega correo
- [ ] Sin `N8N_TEST_RECIPIENT`, el correo llega al `contact_email` real del cliente
- [ ] No hay envios duplicados (una sola ejecucion en n8n por accion)
- [ ] Si `N8N_TEST_RECIPIENT=tucorreo@gmail.com`, el subject lleva `[TEST]` y banner amarillo

## Instrucciones para la IA (Claude / asistente)

Si estas revisando este PR como asistente IA, esto es lo que necesitas saber para ayudar al revisor:

### Archivos clave

| Archivo | Rol |
|---|---|
| `src/lib/services/notificationService.ts` | Construye HTML, encola en BD, dispara envio a n8n |
| `src/lib/services/n8nWebhook.ts` | Helper HTTP para llamar al webhook de n8n |
| `n8n/workflows/notificaciones-email.json` | Workflow de n8n (webhook → Set fields → Gmail) |
| `docs/09-notificaciones.md` | Este documento |
| `src/app/api/samples/route.ts` (POST) | Trigger: `sample_received` |
| `src/app/api/samples/[id]/route.ts` (PUT, PATCH) | Trigger: cambio de estado |
| `src/app/api/results/[id]/validate/route.ts` (PATCH) | Trigger: resultado validado |
| `src/app/api/results/[id]/route.ts` (PUT) | Trigger: resultado validado (ruta legacy) |

### Flujo completo

```
Accion del usuario en UI
  → fetch a ruta API (ej. PATCH /api/samples/ID)
    → la ruta actualiza la BD
    → la ruta llama a notifyStatusChange() / notifyResultsReady()
      → enqueueNotification()
        1. INSERT en notifications (status: 'queued')
        2. buildEmail() — construye HTML completo
        3. si N8N_TEST_RECIPIENT configurado → redirige ahi con banner [TEST]
        4. sendToN8n(payload) → POST al webhook
          → n8n recibe → Set fields → Gmail.send()
        → UPDATE notifications.status = 'sent' o 'error'
```

### Puntos criticos a verificar

1. **Expresion del campo `to` en n8n**: debe ser `{{ ($json.body.to_email || '').trim() }}` — NUNCA usar `=` al inicio (rompe la interpolacion)
2. **`N8N_TEST_RECIPIENT` vacio en produccion**: si tiene valor, TODOS los correos van a esa direccion
3. **El `html` en el payload YA viene construido** desde LIMS — n8n solo reenvia, no reconstruye
4. **Fire-and-forget**: las llamadas usan `.catch()` y no bloquean la respuesta HTTP

### Diagnostico de fallos comunes

| Sintoma | Causa probable | Solucion |
|---|---|---|
| Correo duplicado | `=` sobrante en expresion n8n (`={{ ... }}`) | Quitar el `=` inicial, dejar `{{ ... }}` |
| Error 550 "email does not exist" | `N8N_TEST_RECIPIENT` apunta a correo inexistente | Corregir o dejar vacio |
| Correo siempre al mismo destinatario | `N8N_TEST_RECIPIENT` esta configurado | `N8N_TEST_RECIPIENT=` (vacio) para envio real |
| Workflow n8n responde 404 | Workflow pausado o webhook mal configurado | Activar el workflow en n8n |
| Notificacion `queued` pero nunca `sent` | n8n no accesible o webhook URL mal | `curl -X POST <N8N_URL>` para probar conectividad |
| HTML del correo roto (`=<!DOCTYPE...`) | Expresion n8n mal evaluada por caracteres `<` `>` | Usar `{{ $json.body.html }}` sin `=` ni transformaciones |
| Servidor arranca pero no envia | Proceso viejo en puerto 3000 con env antiguo | `npx kill-port 3000 && npm run dev` |

### Comandos utiles para el revisor

```bash
# Verificar conectividad con n8n
curl -X POST $N8N_NOTIFICATIONS_WEBHOOK_URL \
  -H "Content-Type: application/json" \
  -d '{"to_email":"test@gmail.com","subject":"Test LIMS","html":"<h1>Hola</h1>","is_test":true,"template_code":"test"}'

# Ver notificaciones en la BD (usando Supabase SQL Editor o psql)
SELECT id, to_ref->>'email', template_code, status, error, created_at
FROM notifications ORDER BY created_at DESC LIMIT 10;

# Limpiar notificaciones de prueba
DELETE FROM notifications WHERE status = 'queued';

# Matar procesos huerfanos en puerto 3000 (Windows)
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Reiniciar servidor limpio
npx kill-port 3000 && npm run dev
```
