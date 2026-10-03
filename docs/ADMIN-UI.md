# Panel de administración (fase visual)

El panel `Department-admin` vive por ahora en `Department-frontend/admin` y **no consume la API todavía**:
usa datos simulados. Esta rama del backend no modifica endpoints; solo deja constancia de que, al conectar el panel,
se consumirá `/api/v1/admin/*` según `docs/API.md` y `docs/openapi.json` (ver `admin/README.md` en el repo del frontend).
