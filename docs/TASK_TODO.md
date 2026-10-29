# Gateward SDK — Task Backlog

> Tracking activo del SDK. Uso en el [README](../README.md), flujo en [DEVELOPMENT.md](./DEVELOPMENT.md), decisiones de
> diseño en [ARCHITECTURE/SESSION.md](./ARCHITECTURE/SESSION.md), integración
> en [GUIDES/MIGRATION.md](./GUIDES/MIGRATION.md). Lo cerrado se archiva por mes
> en [TASK_COMPLETED/](./TASK_COMPLETED/).

---

Cada tarea dice qué, dónde y cuándo está hecha. `Onboarding: si` marca una buena primera
tarea (chica e independiente); DIST-001 y PY-001 las hace el equipo core.

## Estado `updated: 2026-10-15`

Superficie de cliente/integrador **completa contra el contrato** del Core (79 paths,
regenerado en octubre): auth, perfil propio, password, email, borrado de cuenta, sesiones,
roles de app, config pública con guarda de environment, eventos y verificación de JWT.
Lo no cubierto es admin/control-plane, que por diseño vive en el dashboard.

`main`: PRs #9–#34, 149 tests, 4 entries (`index`, `server`, `react`, `next`). CI verde
en Node 20 y 22 (runners Strongback `sbk-small`; los PRs de forks caen a `ubuntu-latest`).

El demo (`gateward-sdk-demo` #2) ejercita **toda** la superficie, incluida la guarda de
environment, el cambio de email en dos pasos y el borrado de cuenta.

Próximo paso: **publicar** (DIST-001, faltan la org de npm y el token) y que la app
piloto lo aplique. Su feedback manda sobre el resto del backlog.
---

## Priority 1 — Desbloquear la primera integración

### DIST-001: Distribución pública `added: 2026-08-03`
- [ ] Crear la org `gateward` en npm y el secret `NPM_TOKEN`.
- [ ] Primer `npm publish` — lo corre una persona, no CI (irreversible).
- Verificado 2026-10-15: `npm view @gateward/sdk` responde 404 y el repo no tiene tags, así que sigue sin publicarse.
- Onboarding: no (irreversible, lo hace el equipo core).
- Hecho cuando: `npm view @gateward/sdk` devuelve la versión y existe el tag `v0.1.0`.
- Verificado 2026-10-15: `pnpm publish --dry-run --no-git-checks` pasa typecheck, tests y build, y el tarball solo trae `dist/`, README, LICENSE y CHANGELOG.
- Lo ya hecho (paquete publicable, CHANGELOG, workflow por tag) está en `TASK_COMPLETED/2609.md`.

### PILOT-001: Primera integración real `added: 2026-08-03`
- Onboarding: no (depende del equipo de la app piloto). No verificado: el avance de la piloto no se ve desde este repo.
- [ ] La aplica el equipo de la app piloto; nosotros respondemos su feedback.
- [ ] Análisis previo en `GUIDES/MIGRATION.md`. Si la piloto corre sobre Convex,
  sus queries/mutations no pueden hacer `fetch` y no verifican un JWT por sí
  solas — se resuelve con el discovery OIDC del Core y `convex/auth.config.ts`,
  con `applicationID` = el UUID del app.

---

## Priority 2 — Después del primer feedback

### PY-001: SDK de Python `added: 2026-08-03`
- Onboarding: no (equipo core).
- Hecho cuando: existe el paquete con `verify_token` y `send_event` y la guía de migración deja de listar a Python como bloqueador.
- [ ] Verificado 2026-10-15: no hay código Python en el repo ni tarea hermana en el backlog del Core (no verificado si el equipo core la planea). La hace el equipo core.
- [ ] Verificación de token (JWKS + ES256) y cliente de eventos para backends
  Python (Django/DRF, FastAPI). **Es el único bloqueador que queda en la guía
  de migración.**
- [ ] **Diferido a propósito**: ninguno de sus consumidores está migrando
  todavía, y la app piloto es TypeScript. Se retoma cuando la primera
  integración esté cerrada.
- [ ] Alcance estimado: `verify_token` + `send_event`, ~150 LOC. No necesita
  paridad con el SDK de TS — un backend Python no hace login de usuario.

### E2E-001: Validar contra un Core desplegado `added: 2026-08-03`
- Onboarding: no (bloqueado por prod). Hecho cuando: el ciclo completo pasa contra un Core real con las dos apps. No verificado: el estado del recurso de prod en Coolify.
- [ ] Todo el suite corre contra stubs. Falta ejercitar el ciclo completo contra
  un Core real con dos apps: una con `require_email_verification` y otra sin.
- [ ] **Bloqueado por prod**: hoy no existe el recurso en Coolify (Core DEPLOY-006).
  Al desplegar, `JWT_ISSUER` tiene que ser la URL pública o el discovery OIDC no
  sirve — y el error se ve del lado del cliente, no del server. La guía del Core
  `GUIDES/INTEGRATION_TESTING.md` trae el checklist para este item.

---

## Bloqueado por el Core

**Nada.** Los diez pedidos se entregaron y están integrados en el SDK:
SELF-001, APP-POLICY-001, ROLE-001, OIDC-001, HASH-IMPORT-001, SELF-DELETE-001,
REGISTER-PROFILE-001, EMAIL-CHANGE-001, APP-CONFIG-001 y ABUSE-TENANT-001.

Lo único que falta del lado del Core es **operativo**: crear el recurso de prod en
Coolify desde la imagen de GHCR (`v0.1.0` ya publicada).

---

## Rendimiento (auditoría 2026-10-22) `added: 2026-10-22`

> Salió de leer `src/` y de los entries de `dist/`. **Inferido del código**, sin medir en navegador.

### PERF-S01: Sacar `JwtVerifier` del entry `index` `added: 2026-10-22`
- Qué: `src/index.ts` exporta `JwtVerifier`, que importa `jose` (`src/jwt/verify.ts`). Vite lo descarta por `sideEffects: false` y en el dashboard solo entran ~8.5 kB de `jose`, pero un bundler que no respete `sideEffects`, o un consumidor CJS (`dist/index.cjs` pesa 36.8 kB), arrastraría la verificación completa al navegador.
- Hecho cuando: `dist/index.js` no importa `jose` desde `GatewardAuth`, `JwtVerifier` vive solo en `/server`, el cambio queda en el CHANGELOG y la versión sigue `RELEASING.md` (es cambio de API).
- [ ] Mover el export y actualizar README y demo
- Onboarding: no (cambio de API)

## Backlog

### RBAC-001: Helpers de roles `added: 2026-08-03`
- Onboarding: no (es una decisión de diseño). Hecho cuando: queda escrita la decisión en `docs/ARCHITECTURE/`.
- [ ] El Core ya permite asignar `app_admin`, y el SDK expone
  `listMembers`/`setMemberRole`. Falta decidir si el SDK opina sobre permisos
  (matriz rol → permiso) o eso se queda en cada app.
- [ ] Varias apps auditadas tenían matrices RBAC casi idénticas — señal de que
  hay algo común, pero también de que cada una la quiere suya. Decidir con datos
  del primer piloto, no antes.

### STORAGE-001: Alternativa a localStorage `added: 2026-08-03`
- Onboarding: no (se evalúa tras el piloto). Código: `createWebStorage` en `src/core/storage.ts`.
- [ ] `createWebStorage()` deja los tokens expuestos a XSS. Documentado, pero no
  hay alternativa por cookie. Evaluar tras el primer piloto en producción.
