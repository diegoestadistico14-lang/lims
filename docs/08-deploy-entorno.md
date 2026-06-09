# 08 — Deploy y Entorno

> Última actualización: 2026-05-20.

## Proposito

Este documento describe como desplegar el LIMS en Railway, las variables de entorno necesarias, y la configuracion de servicios externos.

## Documentos relacionados

| Doc | Relacion |
|---|---|
| `01-arquitectura.md` | Estructura del proyecto, standalone output |
| `02-autenticacion.md` | Variables de entorno Supabase |
| `07-reportes-pdf.md` | Variables PDFMonkey, webhook |
| `09-notificaciones.md` | Variables n8n, modo prueba |

## Stack de deploy

- **Plataforma**: Railway
- **Runtime**: Node.js 20.x en Docker
- **Build**: `next build` con `output: 'standalone'`
- **Base de datos**: Supabase Cloud (no se despliega en Railway)
- **PDF**: PDFMonkey API (externo)
- **Notificaciones**: n8n (Docker, webhook + SMTP)

## Dockerfile

El proyecto usa el output `standalone` de Next.js, que genera un build autocontenido con todas las dependencias necesarias:

```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
```

## Variables de entorno (18 variables)

### Supabase (obligatorio)

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...       # NUNCA exponer al navegador
```

### PDFMonkey

```bash
PDFMONKEY_API_KEY=xxxxx                # API key de PDFMonkey
# Templates (opcionales, tienen defaults)
PDFMONKEY_TEMPLATE_VIROLOGY=UUID
PDFMONKEY_TEMPLATE_PHYTOPATOLOGY=UUID
PDFMONKEY_TEMPLATE_NEMATOLOGY=UUID
PDFMONKEY_TEMPLATE_BACTERIOLOGY=UUID
PDFMONKEY_TEMPLATE_EARLY_DETECTION=UUID
PDFMONKEY_TEMPLATE_DEFAULT=UUID
```

### n8n (notificaciones por correo)

```bash
N8N_NOTIFICATIONS_WEBHOOK_URL=https://n8n.railway.app/webhook/lims-notificaciones  # URL del webhook
N8N_WEBHOOK_USER=admin                 # Basic Auth user (opcional)
N8N_WEBHOOK_PASSWORD=xxxxx             # Basic Auth password (opcional)
N8N_TEST_RECIPIENT=test@midominio.com  # Solo desarrollo: redirige TODOS los correos aqui
```

n8n se despliega como servicio separado (Docker). Ver `docker-compose.yml` y `docs/09-notificaciones.md`.

### Branding

```bash
NEXT_PUBLIC_NEMACHILE_HOSTS=app.nemachile.cl
NEXT_PUBLIC_SAAS_HOSTS=lims.agroanalytics.cl
NEXT_PUBLIC_BRANDING_FALLBACK=nemachile
```

### Negocio

```bash
MAX_COMPANIES_PER_EMAIL=1              # Limite de empresas por email
CRON_SECRET=xxxxx                      # Secreto para endpoints cron
```

### Opcional (desarrollo)

```bash
NODE_ENV=production
```

## Configuracion en Railway

### Health check

Railway necesita un endpoint para health check. Crear un endpoint especifico `GET /api/health` que devuelva 200.

**NOTA**: `GET /api/auth/signup` no existe como ruta implementada. No usar para health check.

### Cron job — SLA update

Railway soporta cron jobs via `railway.json` o configuracion en el dashboard:

```json
{
  "cron": {
    "jobs": [
      {
        "schedule": "0 6 * * *",
        "command": "curl -X POST https://app.railway.app/api/cron/sla-update -H 'Authorization: Bearer $CRON_SECRET'"
      }
    ]
  }
}
```

El endpoint `POST /api/cron/sla-update`:
- No usa `withAuth`
- Valida `CRON_SECRET` via header `Authorization: Bearer <secret>`
- Actualiza el estado SLA de todas las muestras activas

### Dominios y SSL

Railway provee un dominio `*.railway.app` con SSL automatico. Para dominios personalizados:
1. Agregar dominio en Railway dashboard
2. Configurar DNS (CNAME a Railway)
3. Railway provisiona SSL via Let's Encrypt

## Supabase — configuracion de redirect URLs

Agregar la URL de Railway a las redirect URLs permitidas en Supabase:

```
Supabase Dashboard → Authentication → URL Configuration
  Site URL: https://app.railway.app (o dominio personalizado)
  Redirect URLs:
    https://app.railway.app/auth/callback
    https://app.railway.app/**
    http://localhost:3000/auth/callback (desarrollo)
```

## Primer deploy (checklist)

1. [ ] Copiar `.env.example` a variables de entorno de Railway
2. [ ] Configurar `CRON_SECRET` (valor seguro, aleatorio)
3. [ ] Verificar `NEXT_PUBLIC_SUPABASE_URL` apunta a la instancia correcta
4. [ ] Ejecutar `scripts/signup-rpc-functions.sql` en Supabase SQL Editor
5. [ ] Agregar URL de Railway a Supabase redirect URLs
6. [ ] Hacer deploy
7. [ ] Probar: login → signup → verificar email → setup company → dashboard
8. [ ] Probar: crear muestra → ingresar resultado → generar reporte PDF
9. [ ] Verificar cron job (revisar logs de Railway)

## Logs y monitoreo

- **Railway logs**: `railway logs` (CLI) o dashboard web
- **Supabase logs**: Supabase Dashboard → Database → Logs
- **Errores de API**: `console.error` en los handlers, visibles en Railway logs
- **PDFMonkey**: logs en PDFMonkey dashboard

## Rollback

```bash
# Railway mantiene historial de deploys
railway up --deploy-id <previous-deploy-id>
```

O hacer revert del commit y push a main (si esta configurado auto-deploy).

## Entorno local

```bash
cp .env.example .env.local
# Editar .env.local con valores de desarrollo
npm run dev
# http://localhost:3000
```

Variables minimas para desarrollo local:
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
PDFMONKEY_API_KEY
CRON_SECRET
```

## Reglas

1. **Nunca commitear `.env.local` o `.env.production`** — estan en `.gitignore`
2. **Rotar `SUPABASE_SERVICE_ROLE_KEY` si se expone** — es la llave maestra
3. **Probar build local antes de deploy**: `npm run build && npm start`
4. **No usar `NODE_ENV=development` en produccion** — activa logs detallados y desactiva optimizaciones
5. **Railway asigna puerto via `PORT` env var** — Next.js lo detecta automaticamente
