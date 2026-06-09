## Code Best Practices

- Always use descriptible variables names

## Notificaciones por correo (n8n)

Si estas revisando cambios relacionados con notificaciones:

- **Servicio**: `src/lib/services/notificationService.ts` y `src/lib/services/n8nWebhook.ts`
- **Workflow n8n**: `n8n/workflows/notificaciones-email.json`
- **Docs completas**: `docs/09-notificaciones.md` (leer ANTES de revisar)
- **Triggers**: `POST /api/samples`, `PUT|PATCH /api/samples/[id]`, `PATCH /api/results/[id]/validate`

### Para que el revisor pueda probar

1. Necesita n8n corriendo (Docker: `docker-compose up -d` o instancia cloud)
2. Importar el workflow `n8n/workflows/notificaciones-email.json` en n8n
3. Configurar credenciales Gmail/SMTP en el nodo de envio
4. Activar el workflow
5. `.env.local`: `N8N_NOTIFICATIONS_WEBHOOK_URL=<url>`, `N8N_TEST_RECIPIENT=` (vacio para envio real)
6. Crear/cambiar muestras en LIMS y verificar que los correos llegan