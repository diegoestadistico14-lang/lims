# 01 — Arquitectura General

> **Estado**: TO-BE / Parcialmente implementado. Ver `docs/AS-IS-estado-actual.md` para el estado real del código.
> Última actualización: 2026-05-20.

## Proposito

Este documento describe la arquitectura de alto nivel del LIMS, las decisiones de diseno fundamentales, y como se conectan las capas del sistema. Es el punto de partida para entender el proyecto como un todo.

## Documentos relacionados

| Doc | Relacion |
|---|---|
| `02-autenticacion.md` | Sistema de auth, withAuth(), roles, middleware |
| `03-api-routes.md` | Catalogo de endpoints, patrones de codificacion |
| `04-base-de-datos.md` | Esquema DB, PostgREST, RLS |
| `05-frontend.md` | Organizacion del frontend, reglas browser client vs API |
| `06-multi-tenant.md` | Aislamiento company_id, capas de defensa |
| `07-reportes-pdf.md` | Generacion de PDFs, PDFMonkey |
| `08-deploy-entorno.md` | Deploy en Railway, variables de entorno |
| `09-notificaciones.md` | Notificaciones por correo via n8n (webhook + Gmail API) |

## Diagrama de capas

```
┌─────────────────────────────────────────────────────────┐
│  Navegador (React 19)                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │ Paginas  │ │ AuthCtx  │ │ Hooks    │ │ Componentes│  │
│  │ 13 pages │ │ session  │ │ useAuth  │ │ por dominio│  │
│  └──────────┘ └──────────┘ └──────────┘ └───────────┘  │
│        │              │            │                     │
│        ▼              ▼            ▼                     │
│  fetch() a /api/*  Supabase      Zustand               │
│                    (realtime)    (local state)           │
└──────┬────────────────┬─────────────────────────────────┘
       │                │
       │ HTTP           │ WebSocket (solo SLA + auth)
       ▼                ▼
┌─────────────────────────────────────────────────────────┐
│  Next.js 15 Server (standalone output)                  │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Middleware (routing, auth redirects)            │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │  API Routes (~39 endpoints, 24+ con withAuth)   │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │   │
│  │  │ withAuth │ │ Services │ │ pdfmonkey/route  │  │   │
│  │  │ wrapper  │ │ (3 files)│ │ (~1400 lineas)   │  │   │
│  │  └──────────┘ └──────────┘ └──────────────────┘  │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Pages (Client Components + Server Components)   │   │
│  └──────────────────────────────────────────────────┘   │
└──────────┬──────────────────────────────────────────────┘
           │ HTTP (PostgREST + GoTrue)
           ▼
┌─────────────────────────────────────────────────────────┐
│  Supabase Cloud                                         │
│  ┌────────────┐ ┌───────────┐ ┌──────────────────┐     │
│  │ PostgreSQL │ │ GoTrue    │ │ Storage (S3)     │     │
│  │ + PostgREST│ │ (Auth)    │ │ (imagenes, PDFs) │     │
│  │ + RLS      │ │           │ │                  │     │
│  └────────────┘ └───────────┘ └──────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

## Decisiones de diseno clave

### 1. Monolito Next.js (no separado front/back)

**Por que**: el proyecto es un solo equipo, el contexto compartido entre front y back es valioso, y Next.js permite separar despues si es necesario. La carpeta `src/app/api/` actua como backend.

**Implicacion**: compartir tipos entre API y frontend es trivial (mismo repo, mismo `src/types/`). Pero hay que ser disciplinado con la separacion logica — no importar codigo de servidor en componentes cliente.

### 2. withAuth() como unica puerta de autenticacion (ADOPTADO — 24/35 rutas)

Toda ruta API DEBE usar `withAuth()` de `src/lib/auth/api-auth.ts`. Esto garantiza:
- Un solo lugar para cambiar el comportamiento de auth
- Mensajes de error consistentes (401 para auth, 500 sanitizado para errores)
- El cliente Supabase correcto (server, cookie-based) siempre disponible
- El contexto `{ user, supabase, params }` inyectado automaticamente

**Estado actual**: 24 de 35 rutas usan `withAuth()`. Las 11 restantes incluyen rutas publicas legitimas (cron, callback, webhook de PDFMonkey, accept-invite) que no requieren auth de usuario. El wrapper esta en `src/lib/auth/api-auth.ts` y exporta tambien el tipo `SupabaseServerClient` para helpers tipados.

### 3. PostgREST como capa de acceso a datos

No hay ORM. Las queries se escriben con el cliente de Supabase que traduce a PostgREST (REST API sobre PostgreSQL). Ventajas:
- RLS se aplica automaticamente por usuario autenticado
- Joins via embedding (`samples!inner(...)`)
- Menos codigo que SQL raw

### 4. Multi-tenant via company_id

Cada tabla de negocio tiene `company_id`. Las queries siempre filtran por `company_id` del usuario autenticado. Ver `docs/06-multi-tenant.md`.

### 5. SECURITY DEFINER para operaciones privilegiadas

Operaciones que requieren bypassear RLS (como crear un perfil de usuario sin tener company aun) usan funciones PostgreSQL `SECURITY DEFINER`. Ver `scripts/signup-rpc-functions.sql`.

## Flujo de datos tipico

```
1. Usuario hace clic en "Crear muestra"
2. Componente: EnhancedSampleForm
3. fetch('POST /api/samples', { body: formData })
4. withAuth() valida JWT → obtiene user + supabase client
5. Handler verifica company_id del user
6. supabase.from('samples').insert({...company_id}).select()
7. PostgREST traduce a INSERT SQL + aplica RLS
8. PostgreSQL ejecuta, devuelve row
9. Handler responde JSON 201
10. Componente: actualiza UI optimista o refetch
```

## Directorios por responsabilidad

| Directorio | Responsabilidad | Modo |
|---|---|---|
| `src/app/api/` | Endpoints REST | Server-only |
| `src/app/(paginas)/` | Pages con Server Components | Hybrid |
| `src/components/` | Componentes React reutilizables | Client (la mayoria) |
| `src/lib/services/` | Logica de negocio pura (notificationService, n8nWebhook, slaService) | Server-only |
| `src/lib/reports/` | Servicio de reportes (`reportService.ts`) | Server-only |
| `src/app/api/reports/pdfmonkey/route.ts` | Logica de generacion PDF (builders inline, ~1400 lineas) | Server-only |
| `src/lib/auth/` | withAuth(), constantes | Server-only |
| `src/lib/supabase/` | Clientes Supabase (server + browser) | Server + Client |
| `src/lib/branding/` | Deteccion de marca blanca | Server |
| `src/contexts/` | React contexts (auth, branding) | Client |
| `src/hooks/` | Custom hooks React | Client |
| `src/types/` | Tipos TypeScript (database.ts) | Compartido |
| `src/middleware.ts` | Proteccion de rutas, redirects | Server (Edge) |

## Entorno de desarrollo

```bash
# Requisitos
Node 20.x
npm

# Setup
cp .env.example .env.local  # Configurar variables
npm install
npm run dev                  # http://localhost:3000

# Base de datos
# Ejecutar scripts/signup-rpc-functions.sql en Supabase SQL Editor
# (solo una vez, al configurar el proyecto)
```

## Servicios externos

| Servicio | Proposito | Tipo |
|---|---|---|
| Supabase | Base de datos, auth, storage | Cloud |
| PDFMonkey | Generacion de PDFs | API |
| n8n | Orquestador de notificaciones por correo (Gmail API) | Cloud / Docker |
| Railway | Plataforma de deploy | Cloud |

## Limitaciones y riesgos tecnicos

- **PostgREST `.in()` con arrays grandes**: no usar `.in('id', hugeArray)` con cientos de IDs. Usar `!inner` join (ver `docs/03-api-routes.md`).
- **Singleton browser client**: el cliente de navegador se crea una vez (`src/lib/supabase/singleton.ts`). No recrear en cada componente.
- **Cache de sesion**: `AuthContext` cachea datos de usuario por 5 minutos. Usar `refreshSession(true)` para bypass despues de cambios criticos (ej: creacion de empresa).
- **Password reset**: no implementado aun. Usa el flow de Supabase Dashboard para resets manuales.
