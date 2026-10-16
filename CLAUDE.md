# Gateward SDK

Orientación para agentes. Aquí no hay comandos ni código: el gate, el flujo de git y
las reglas viven en [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md).

## Qué es

`@gateward/sdk`, el SDK de cliente e integrador de Gateward (repo público, MIT). Cubre
auth de usuario final en el navegador, verificación de JWT y eventos en el backend, y
la superficie headless de acceso, listas y formularios. Lo de administración
(control-plane) no está aquí: vive en el dashboard.

## Entradas del paquete

| Entrada | Fuente | Para qué |
|---|---|---|
| `@gateward/sdk` | `src/index.ts` | Cliente de navegador (`GatewardAuth`), sesión, storage, errores |
| `@gateward/sdk/server` | `src/server.ts` | Backend: verificación de JWT, eventos, invitaciones, listas, formularios |
| `@gateward/sdk/react` | `src/react.ts` | Provider y hooks, sin JSX de UI |
| `@gateward/sdk/next` | `src/next.ts` | Integración con Next.js |

## Dónde está cada cosa

- `openapi.json`: el contrato con el Core. Es la fuente de los tipos en `src/generated/api.ts`, que no se edita a mano. Cuando el Core cambia, se regenera y se revalida.
- `src/core/`: lógica compartida (http, sesión, storage, miembros, acceso, mensajería, formularios).
- `src/auth/`, `src/jwt/`, `src/react/`: cliente, verificación de token y hooks.
- `test/`: vitest, contra stubs.
- `.github/workflows/`: `ci.yml` (gate) y `release.yml` (publicación por tag).

## Documentación

- [README.md](./README.md): uso del SDK
- [docs/README.md](./docs/README.md): índice y reglas de escritura
- [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md): setup, gate, contrato, ramas, CI
- [docs/ARCHITECTURE/SESSION.md](./docs/ARCHITECTURE/SESSION.md): diseño de sesión y refresh
- [docs/GUIDES/MIGRATION.md](./docs/GUIDES/MIGRATION.md): integración desde otros patrones de auth
- [docs/GUIDES/RELEASING.md](./docs/GUIDES/RELEASING.md): SemVer y publicación
- [docs/TASK_TODO.md](./docs/TASK_TODO.md): backlog. Lo cerrado va a [docs/TASK_COMPLETED/](./docs/TASK_COMPLETED/README.md)

## Tareas entre repos

Una tarea que cruza repos se parte en una por repo, con línea `Related:`. El Core es el
repo hermano `gateward-core`; su backlog no se toca desde aquí.
