# 03 — API Routes

> **Estado**: TO-BE. Varios endpoints documentados no estan implementados aun. Ver `docs/AS-IS-estado-actual.md` para el inventario real.
> Última actualización: 2026-05-20.

## Proposito

Este documento cataloga los endpoints REST del LIMS (implementados y planificados), explica los patrones de codificacion, y documenta las reglas que toda ruta API debe seguir.

## Documentos relacionados

| Doc | Relacion |
|---|---|
| `01-arquitectura.md` | Arquitectura general, withAuth, flujo de datos |
| `02-autenticacion.md` | withAuth() en detalle, roles, server client |
| `06-multi-tenant.md` | Como aplicar filtro company_id en cada endpoint |
| `07-reportes-pdf.md` | Endpoints de reportes y PDFMonkey |
| `09-notificaciones.md` | Sistema de notificaciones, templates, puntos de disparo |

## Patron universal

Toda ruta protegida sigue este formato:

```ts
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/api-auth'

export const GET = withAuth(async (request, { user, supabase }) => {
  // 1. Obtener company_id del usuario
  const { data: userData } = await supabase
    .from('users')
    .select('company_id')
    .eq('id', user.id)
    .single()

  const companyId = userData?.company_id

  // 2. Validar acceso
  if (!companyId) {
    return NextResponse.json({ error: 'Sin empresa asignada' }, { status: 400 })
  }

  // 3. Construir query con filtro multi-tenant
  const { data, error } = await supabase
    .from('tabla')
    .select('*', { count: 'exact' })
    .eq('company_id', companyId)

  // 4. Manejar error de DB
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 5. Responder
  return NextResponse.json({ data })
})
```

## Filtrado multi-tenant: dos patrones

### Patron A: tabla tiene `company_id`

La mayoria de las tablas. Filtro directo:

```ts
// samples, clients, reports, projects, etc.
query = supabase.from('tabla').select('*').eq('company_id', companyId)
```

### Patron B: tabla SIN `company_id` (se une via FK)

Tablas como `results` que dependen de `samples.sample_id → samples.company_id`. Usar PostgREST `!inner` join:

```ts
// CORRECTO: inner join a nivel de PostgREST
query = supabase.from('results')
  .select(`*, samples!inner(id, code, clients(name))`)
  .eq('samples.company_id', companyId)

// INCORRECTO: dos queries + .in() con array
// Esto causa URLs enormes y timeouts undici
const { data: samples } = await supabase.from('samples').select('id').eq('company_id', companyId)
const ids = samples.map(s => s.id)
query = supabase.from('results').select('*').in('sample_id', ids)
```

## Paginacion

Endpoints que devuelven colecciones usan paginacion:

```ts
const page = parseInt(url.searchParams.get('page') || '1')
const limit = parseInt(url.searchParams.get('limit') || '20')
const allowedLimits = [20, 50, 100]  // Limitar para evitar abusos
const limit = allowedLimits.includes(requestedLimit) ? requestedLimit : 20

const from = (page - 1) * limit
const to = from + limit - 1

const { data, error, count } = await query
  .order('created_at', { ascending: false })
  .range(from, to)

return NextResponse.json({
  data,
  pagination: {
    page,
    limit,
    total: count || 0,
    pages: Math.ceil((count || 0) / limit)
  }
})
```

## Manejo de errores

- **401**: `withAuth` lo maneja automaticamente (AuthenticationError)
- **400**: validacion de input (campos requeridos, formatos)
- **404**: recurso no encontrado
- **409**: conflicto (ej: email duplicado, limite de empresas)
- **500**: error interno (`withAuth` atrapa excepciones no manejadas y devuelve mensaje sanitizado: `'Internal server error'`)

Los handlers deben devolver errores de DB explicitamente (con `error.message` en desarrollo o mensaje sanitizado en produccion). `withAuth` solo atrapa las excepciones que se escapan del handler — no reemplaza el manejo explicito de `if (error)` en las queries de Supabase.

## Catalogo de endpoints

### Auth (publicos o semi-publicos)

| Metodo | Ruta | Auth | Descripcion |
|---|---|---|---|
| POST | `/api/auth/signup` | No | [NO IMPLEMENTADO] Registro de usuario |
| POST | `/api/auth/setup-company` | withAuth | [NO IMPLEMENTADO] Crear empresa + asignar admin |
| POST | `/api/auth/accept-invite` | Token | Aceptar invitacion (publico, basado en token) |
| PATCH | `/api/auth/user` | withAuth | Actualizar datos del usuario |
| POST | `/api/auth/setup` | withAuth | Setup post-registro: crea perfil, asigna rol, loguea accion |

### Samples

| Metodo | Ruta | Descripcion |
|---|---|---|
| GET | `/api/samples` | Listar muestras (paginado, filtros: status, sla_status, client_id) |
| POST | `/api/samples` | Crear muestra + sample_tests |
| GET | `/api/samples/[id]` | Obtener muestra por ID |
| PUT | `/api/samples/[id]` | Actualizar muestra |
| PATCH | `/api/samples/[id]` | Actualizacion parcial |
| DELETE | `/api/samples/[id]` | Eliminar muestra |
| GET | `/api/samples/[id]/tests` | Listar tests de una muestra |
| POST | `/api/samples/[id]/tests` | Agregar test a muestra |
| DELETE | `/api/samples/[id]/tests/[sample_test_id]` | Eliminar test de muestra |
| GET | `/api/samples/[id]/units` | Listar unidades de muestra |
| POST | `/api/samples/[id]/units` | Crear unidad de muestra |

### Results

| Metodo | Ruta | Descripcion |
|---|---|---|
| GET | `/api/results` | Listar resultados (paginado, filtros: status, test_area, sample_id) |
| POST | `/api/results` | Crear resultado (con resolucion de IDs a nombres) |
| GET | `/api/results/[id]` | Obtener resultado por ID |
| PUT | `/api/results/[id]` | Actualizar resultado completo |
| PATCH | `/api/results/[id]` | Actualizacion parcial |
| DELETE | `/api/results/[id]` | Eliminar resultado |
| PATCH | `/api/results/[id]/validate` | Validar resultado |

### Reports

| Metodo | Ruta | Descripcion |
|---|---|---|
| GET | `/api/reports` | [NO IMPLEMENTADO] Listar reportes |
| POST | `/api/reports` | [NO IMPLEMENTADO] Crear reporte (dispara PDFMonkey) |
| GET | `/api/reports/[sampleId]/render` | Renderizar reporte |
| POST | `/api/reports/[sampleId]/render` | Generar PDF de reporte |
| DELETE | `/api/reports/delete/[id]` | Eliminar reporte |
| PATCH | `/api/reports/payment/[reportId]` | Actualizar estado de pago |
| GET | `/api/reports/pdf/[filename]` | Descargar PDF generado |
| POST | `/api/reports/pdfmonkey` | Webhook de PDFMonkey |
| PATCH | `/api/reports/status/[reportId]` | Actualizar estado de reporte |
| GET | `/api/reports/templates` | Listar templates de reporte |
| POST | `/api/reports/templates` | Crear template |
| GET | `/api/reports/view/[id]` | Vista previa de reporte |

### Clients

| Metodo | Ruta | Descripcion |
|---|---|---|
| GET | `/api/clients` | Listar clientes (filtrado por company_id) |
| POST | `/api/clients` | Crear cliente + opcionalmente usuario consumidor |
| PUT | `/api/clients/[id]` | [NO IMPLEMENTADO] Actualizar cliente |
| DELETE | `/api/clients/[id]` | [NO IMPLEMENTADO] Eliminar cliente |

### Settings (admin)

| Metodo | Ruta | Descripcion |
|---|---|---|
| GET | `/api/settings/users` | Listar usuarios de la company |
| POST | `/api/settings/users` | Crear usuario |
| GET | `/api/settings/users/[id]` | Obtener usuario |
| PUT | `/api/settings/users/[id]` | Actualizar usuario |
| DELETE | `/api/settings/users/[id]` | Desactivar usuario |
| GET | `/api/settings/users/[id]/clients` | Clientes asignados a usuario |
| POST | `/api/settings/users/[id]/clients` | Asignar cliente a usuario |
| DELETE | `/api/settings/users/[id]/clients/[clientId]` | Desasignar cliente |
| PUT | `/api/settings/users/[id]/role` | Cambiar rol de usuario |
| GET | `/api/settings/roles` | Listar roles |
| PUT | `/api/settings/roles` | Actualizar rol |
| GET | `/api/settings/orphan-client-emails` | Emails huerfanos de clientes |
| POST | `/api/settings/orphan-client-emails` | Crear usuarios desde emails huerfanos |

### Otros

| Metodo | Ruta | Descripcion |
|---|---|---|
| GET | `/api/dashboard/stats` | Estadisticas del dashboard (muestras, resultados, reportes) |
| GET | `/api/dashboard/recent-samples` | Muestras recientes |
| GET | `/api/estadisticas/charts` | Datos para graficos de estadisticas |
| GET | `/api/notifications/preferences` | Obtener preferencias de notificacion del usuario |
| PUT | `/api/notifications/preferences` | Actualizar preferencias de notificacion |
| GET | `/api/interpretations/rules` | Reglas de interpretacion |
| POST | `/api/interpretations/rules` | Crear regla |
| POST | `/api/interpretations/evaluate` | Evaluar reglas |
| GET | `/api/invitations` | Listar invitaciones |
| POST | `/api/invitations` | Crear invitacion |
| POST | `/api/sla/update` | Actualizar estado SLA |
| POST | `/api/cron/sla-update` | Cron job de SLA (protegido por CRON_SECRET) |
| GET | `/api/projects` | Listar proyectos (filtrado por company_id) |
| POST | `/api/projects` | [NO IMPLEMENTADO] Crear proyecto |
| GET | `/api/test-catalog` | Catalogo de tests activos (global) |
| GET | `/api/methods` | Catalogo de metodos (global) |
| GET | `/api/analytes` | [NO IMPLEMENTADO] Catalogo de analitos |
| GET | `/api/units/[id]/results` | Resultados de unidad |
| POST | `/api/units/[id]/results` | Crear resultado de unidad |

## Crear una nueva ruta (checklist)

1. Crear carpeta: `src/app/api/[recurso]/route.ts`
2. Importar `withAuth` y `NextResponse`
3. Exportar metodos HTTP como constantes: `export const GET = withAuth(...)`
4. Obtener `companyId` del usuario
5. Aplicar filtro multi-tenant (patron A o B segun la tabla)
6. Si es coleccion, implementar paginacion con `allowedLimits`
7. Mensajes de error en español
8. Status HTTP correcto

## Reglas

1. **Nunca devolver datos sin filtrar por company_id** — es un riesgo de seguridad multi-tenant
2. **No crear endpoints publicos sin validacion de branding** (signup bloqueado en nemachile)
3. **No usar `.in()` con arrays potencialmente grandes** — usar `!inner` join
4. **Validar allowedLimits en endpoints paginados** para prevenir abusos
5. **GET nunca debe tener efectos secundarios** (excepto endpoints de callback/auth)
6. **No exponer mensajes de error de Supabase crudos al cliente** en produccion (en desarrollo es aceptable)
