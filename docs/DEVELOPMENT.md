# Desarrollo del SDK

Setup, gate, contrato y flujo de trabajo. Uso del paquete en el [README](../README.md).

## Setup

Node 20 o 22 (el campo `engines` dice `>=18`, pero CI solo prueba 20 y 22) y pnpm 10.

```bash
pnpm install --frozen-lockfile
```

## Gate

Lo mismo que corre CI en `.github/workflows/ci.yml`, en este orden. Ejecutado el
2026-10-15 sobre `main` (598c553): los tres pasaron, 149 tests en 15 archivos.

```bash
pnpm typecheck
pnpm test
pnpm build
```

CI lo corre en Node 20 y 22. Un PR no se mergea en rojo. `pnpm dev` y `pnpm test:watch`
son para iterar, no cuentan como gate.

## Contrato con el Core

`openapi.json` es el contrato y `src/generated/api.ts` sale de él. El SDK envuelve solo
la superficie de cliente e integrador; el resto de los paths (admin) se ignora a propósito.

Cuando el Core cambia su API, el SDK debe regenerar `openapi.json` y revalidar. Si no,
los tipos y los tests siguen verdes contra un contrato viejo y el desfase aparece en
producción. El gate cubre la revalidación: `pnpm typecheck` es el que avisa de campos
renombrados o desaparecidos.

```bash
pnpm gen:contract
pnpm typecheck && pnpm test && pnpm build
```

`gen:contract` ejecuta el binario `dump_openapi` del Core con cargo, así que necesita
`../gateward-core` clonado al lado y en la rama `main` actualizada. No necesita un Core
corriendo. `pnpm gen:types` regenera solo los tipos a partir del `openapi.json` actual.
Comprobado el 2026-10-28 con `gen:contract` completo contra el Core en `954618b`: `openapi.json`
y `src/generated/api.ts` sin cambios (79 paths). Regenerar no es por sí solo un release: ver
[GUIDES/RELEASING.md](./GUIDES/RELEASING.md).

## Ramas y PR

- Una rama por cambio, desde `main` actualizado.
- PR a `main`, CI verde, squash-merge.
- `main` no despliega. `stg` y `prod` solo se mueven con un PR de promoción (`main` a `stg`, luego `stg` a `prod`) con merge commit, nunca squash: el historial de cada rama tiene que seguir siendo ancestro de la siguiente.
- Commits en el estilo del historial (`feat:`, `fix:`, `docs:`, `ci:`, `test:`).

## Tamaño de archivos

Entre 400 y 500 líneas por archivo como tope. Si un archivo se acerca, se parte por
responsabilidad, como ya se hizo en `src/core/` (`access.ts`, `messaging.ts`, `forms.ts`).
`src/generated/api.ts` está exento: es generado.

## CI en repo público

- Los PRs de forks corren en `ubuntu-latest`, nunca en el pool self-hosted. El workflow lo decide con `github.event.pull_request.head.repo.fork`; no se quita.
- Nunca `pull_request_target` con checkout del código del PR: daría secrets y permisos de escritura a código no confiable.
- Los workflows llevan `timeout-minutes` y `concurrency`, y no usan caches en runners efímeros.
- `release.yml` corre solo con tags `v*.*.*` y exige que el tag coincida con `package.json`.
