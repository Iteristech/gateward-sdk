# Gateward SDK: Documentación

> Índice y reglas. El uso está en el [README](../README.md); acá vive el porqué.

## Estructura

> Derivada de [`.doctos.yml`](../.doctos.yml). Editá ese archivo, no esta tabla.

| Carpeta / archivo | Contenido |
|---|---|
| `DEVELOPMENT.md` | Setup, gate, contrato con el Core, ramas, PR y reglas de CI |
| `ARCHITECTURE/` | Decisiones de diseño del SDK (sesión, refresh, storage, SSR) |
| `GUIDES/` | Migración desde otros patrones de auth, política de releases — solo lo no obvio |
| `TASK_TODO.md` | Backlog activo del SDK |
| `TASK_COMPLETED/` | Tareas cerradas, un archivo por mes (`AAMM.md`) |

## Alcance, para no buscar lo que no está

Este SDK cubre la superficie de **cliente/integrador**. Las operaciones de admin
(ecosystems, usuarios, api keys, email providers, webhooks) viven en el dashboard, sobre el
primitivo `AuthSession` que este paquete exporta. Por eso `openapi.json` trae 79 paths y el
SDK envuelve solo los que no son de control-plane.

## Reglas de escritura

1. Solo `README.md`, `CLAUDE.md`, `CHANGELOG.md` y `LICENSE` en la raíz. `CLAUDE.md` es orientación sin comandos; el flujo vive en `DEVELOPMENT.md`.
2. **UPPERCASE_SNAKE_CASE** para docs y **UPPERCASE** para subcarpetas.
3. Tareas solo en `TASK_TODO.md`; lo cerrado va a `TASK_COMPLETED/AAMM.md`.
4. Archivar, no borrar: lo obsoleto va a `ARCHIVED/` con una nota al inicio.
5. Una guía existe solo si dice algo que el código o el comando no muestran ya.
