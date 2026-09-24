# Department-backend

API headless de **Daregular Dept.** — NestJS 11 · TypeORM · PostgreSQL · Zod · OpenAPI.

Plan completo (módulos, modelo de datos, endpoints, fases, roles): [`docs/PLAN.md`](docs/PLAN.md).

## Requisitos

- Node ≥ 22 y yarn 1.x (`corepack enable`).
- **No hace falta Docker ni Postgres instalado**: `yarn db:start` levanta uno embebido.

## Arranque local

```bash
yarn install
cp .env.example .env          # ya apunta al Postgres embebido (puerto 5433)
yarn db:start                 # terminal 1 — Postgres local (Ctrl+C para parar)
yarn start:dev                # terminal 2 — API en http://localhost:4000
yarn smoke                    # terminal 3 — comprobación rápida (8 checks)
```

- Swagger UI: http://localhost:4000/docs · JSON: `/docs-json` (desactivado por defecto en `production`).
- Ops (sin prefijo): `GET /health` · `GET /ready` (BD) · `GET /version`.
- API versionada bajo `/api/v1`.

## Scripts

| Comando | Descripción |
| --- | --- |
| `yarn start:dev` | API con recarga |
| `yarn build` / `yarn start:prod` | Compila a `dist/` y la sirve |
| `yarn lint` · `yarn typecheck` | ESLint · `tsc --noEmit` |
| `yarn db:start` | Postgres embebido en `.data/pg` |
| `yarn migration:generate src/database/migrations/Nombre` | Genera migración desde las entidades |
| `yarn migration:run` · `yarn migration:revert` | Aplica / revierte migraciones |
| `yarn smoke` | Comprobaciones contra una API en marcha (`API_URL=…`) |

## Configuración

Todas las variables se validan con Zod al arrancar (`src/config/env.ts`): si falta o está mal formada
alguna, el proceso se detiene con una lista legible. Ver `.env.example`.

## Estructura

```
src/
  config/      variables de entorno validadas (ENV token)
  database/    TypeORM (módulo, DataSource del CLI, entidad base, naming snake_case, migrations/)
  common/      errores uniformes, paginación (cursor + offset)
  health/      /health · /ready · /version
  app.module.ts · main.ts
scripts/       dev-db.mjs (Postgres embebido) · smoke.mjs
```

## Convenciones

- `synchronize` de TypeORM **siempre apagado**: todo cambio de esquema es una migración.
- Cada endpoint valida con Zod (`createZodDto`) y devuelve errores con la forma
  `{ statusCode, error, code, message, details?, requestId }`.
- Una rama por parte, commits pequeños en español, PR y aprobación antes de mergear.
