# Migrar una app a Gateward

Guía por **patrón de auth**: la mayoría de las apps caen en uno de cinco. Cada
sección dice qué se tira, qué se queda, y el diff mínimo.

Referencia de uso en el [README](../../README.md); el porqué de cada primitiva
en [ARCHITECTURE/SESSION.md](../ARCHITECTURE/SESSION.md).

## Antes de empezar

1. Aprovisioná en el dashboard: ecosystem → identity pool → app. Guardá el
   `app_id`.
2. Si tu backend va a verificar tokens o emitir eventos, creá una API key con
   los scopes que necesite (`events:write`, `users:read_app`, …).
3. Agregá el origen de tu app a `CORS_ALLOWED_ORIGINS` del Core. Sin esto el
   browser no puede hablarle.

```bash
pnpm add @gateward/sdk
```

## Mapa de equivalencias

| Lo que tenías | Con el SDK |
|---|---|
| `login(email, password)` propio | `auth.login(email, password)` |
| tabla `users` + bcrypt propio | el Core; tu tabla guarda solo lo tuyo |
| `sessionToken` en localStorage | `createWebStorage()` (o el tuyo) |
| tu refresh manual | automático, single-flight |
| `getCurrentUser()` | `auth.getUser()` |
| `updateProfile(...)` | `auth.updateProfile({...})` |
| `changePassword(...)` | `auth.changePassword(actual, nueva)` |
| provider + hook a mano | `@gateward/sdk/react` |
| interceptor axios/fetch | `auth.createFetch()` |
| gate de middleware Next | `@gateward/sdk/next` |

**Dónde vive el perfil.** Gateward guarda identidad (email, estado, rol de
membership). El nombre visible, avatar, preferencias y el **rol de tu app** van
en `metadata`, que es `app_memberships.local_metadata`. Se lee con `getUser()`
y se escribe con `updateProfile()`.

> `metadata` la escribe el propio usuario. Úsala para mostrar, **nunca para
> autorizar**. Para autorizar, mirá `membership_role` o los `scopes` del token
> verificado en tu backend.

---

## Patrón A — Singleton + subscribe (Convex)

**Ejemplo típico:** una SPA de Vite + React sobre Convex, con un `AuthService`
singleton que expone `subscribe()`, más un `AuthProvider` y un `useAuth`
propios. El token de sesión es opaco y lo emite una action de Convex.

Es el más fácil: la forma ya es idéntica a la del SDK.

- `login` / `logout` / `registerUser` del singleton → métodos de `GatewardAuth`.
- `subscribe(listener)` → `onAuthStateChange()`. Ojo: el SDK distingue
  `signed_out` de `session_expired`; el singleton no lo hacía y por eso la UI
  podía quedar mostrando una sesión muerta.
- `AuthProvider` + `useAuth` propios → los de `@gateward/sdk/react`. El
  `status: 'loading' | 'authenticated' | 'unauthenticated'` ya existe.
- `hydrateSession()` / `ready()` → lo hace el provider al montar.
- Los roles propios de la app van a `metadata.role`. La función que decide a
  qué pantalla cae cada rol se queda en tu código, leyendo de ahí.

Convex sigue siendo tu base de datos: se le saca **solo** la tabla de usuarios y
el módulo de credenciales. Las funciones que hoy reciben un `sessionToken` pasan
a verificar el JWT de Gateward.

## Patrón B — NextAuth v4 + Convex

**Ejemplo típico:** una app Next.js con `CredentialsProvider` contra Convex,
sesión JWT de NextAuth y el rol inyectado en el callback `session`.

- Se va `next-auth` entero: provider, callbacks, `/api/auth/[...nextauth]`,
  `types/next-auth.d.ts`.
- `<SessionProvider>` → `<GatewardProvider>`.
- `useSession()` → `useAuth()`. `status` de NextAuth es
  `loading | authenticated | unauthenticated`: **los mismos tres valores**, así
  que los componentes casi no cambian.
- `session.user.role` → `user.metadata.role` (el de tu app) o
  `user.membership_role` (el de Gateward).
- El `middleware.ts` pasa a `createGatewardMiddleware` — ver Patrón E.
- Tu matriz RBAC **se queda como está**. Sigue siendo tuya; solo cambia de
  dónde sale el rol que le pasás.

⚠ El bootstrap "primer usuario = admin" no es automático: el primer `app_admin`
lo promueve un platform admin, porque dentro de la app todavía no hay nadie con
`app:user_manage`.

## Patrón C — Store + interceptor (zustand/axios)

**Ejemplo típico:** un store de zustand persistido con user + tokens, con
mirror a localStorage para que el interceptor de axios los lea.

- El store deja de guardar tokens: eso es del SDK. Guarda solo estado de UI.
- Tu módulo de storage → `createWebStorage()`. Si versionabas las claves
  (`:v1`) era buena idea; el SDK usa una sola, así que para forzar un sign-out
  global cambiá su nombre.
- El interceptor de axios → `auth.createFetch()`, o dejá axios y usá
  `auth.getAccessToken()` en el interceptor.
- Si tu `register()` devolvía tokens (auto-login), **eso se puede**:
  aprovisioná la app con `require_email_verification: false` y `register()`
  persiste los tokens y emite `signed_in`. Con la verificación activa, el flujo
  es registro → "revisá tu correo" → login.

## Patrón D — JWT propio + localStorage

**Ejemplo típico:** un dashboard Next con access+refresh en localStorage,
refresh single-flight, cookie marcadora y un bus de forced-logout. Es el patrón
que más se parece a Gateward.

Casi todo se borra porque el SDK ya lo trae:

| Lo que tenías | Reemplazo |
|---|---|
| módulo de token store | `withSessionMarker(createWebStorage())` |
| bus de eventos de auth | `onAuthStateChange()` |
| middleware de refresh del cliente HTTP | `auth.createFetch()` |
| tu `AuthProvider` | `<GatewardProvider>` |
| tu cookie marcadora | `SESSION_MARKER_COOKIE` |

Tu `whoami()` → `getUser()`. Un chequeo tipo `user_type !== 'admin'` pasa a
`membership_role` o a `metadata`.

## Patrón E — Gating SSR en Next

Aplica a B y D. Reemplaza el `middleware.ts` hecho a mano:

```ts
import { createGatewardMiddleware } from "@gateward/sdk/next";

const gate = createGatewardMiddleware({
  protect: ["/dashboard", "/settings"],
  authenticatedHome: "/dashboard",
});

export function middleware(request: NextRequest) {
  return gate(request) ?? NextResponse.next();
}
```

Requiere que el cliente use `withSessionMarker(...)`, o el server nunca ve la
cookie.

> **No es autenticación.** Decide si el server pinta el layout autenticado, nada
> más. La cookie es falsificable; autorizá en tu API.

---

## Backend: verificar el token

Tu backend nunca confía en lo que le manda el browser. Verifica el JWT contra
el JWKS del Core, sin round-trip por request:

```ts
import { GatewardServer } from "@gateward/sdk/server";

const gw = new GatewardServer({ baseUrl, apiKey, issuer: baseUrl });
const claims = await gw.verifyToken(bearerToken, APP_ID);
// claims.sub = user id, claims.scopes = permisos
```

**Si tu backend es Python** (Django/DRF, FastAPI) todavía no hay SDK.
Opciones: verificar a mano con `PyJWT` + `PyJWKClient` contra
`/.well-known/jwks.json` (ES256), o esperar al SDK de Python.

## Backend Convex: confiar en los tokens de Gateward

Quién hace qué: **la app** cambia su `convex/auth.config.ts`, remapea sus datos y
exporta sus usuarios. **Gateward** solo importa usuarios y emite tokens; no toca la
base de la app.

```ts
// convex/auth.config.ts
export default {
  providers: [
    {
      domain: process.env.GATEWARD_ISSUER, // JWT_ISSUER del Core, sin barra final
      applicationID: process.env.GATEWARD_APP_ID, // el app_id de Gateward (claim aud)
    },
  ],
};
```

- `domain` debe ser **igual** al `JWT_ISSUER` del Core que firma. Convex lee de ahí
  el discovery y el JWKS ([OIDC_VERIFICATION](../../../gateward-core/docs/GUIDES/OIDC_VERIFICATION.md)).
- Stg y prod son Cores distintos con llaves e issuer distintos. Un deployment de
  Convex apunta a uno solo; el valor va en variables de entorno de Convex, no en el código.
- `ctx.auth.getUserIdentity()` devuelve el `sub`, que es el UUID del usuario en
  Gateward, **no** el id que la app usaba antes.

**Datos existentes.** Todo registro que cuelgue del identificador anterior (campo
`userId`, `tokenIdentifier`, tabla de usuarios propia) hay que remapearlo al `sub`
nuevo. Gateward no lo hace. Al importar, manda el id anterior en `metadata`
(`{"legacy_id": ...}`, queda en `local_metadata`) para poder cruzar viejo y nuevo.
La respuesta del import no devuelve el `sub`; se lee después de la lista de
usuarios de la app (cómo exportarla en lote: no verificado). El orden recomendado
es: importar, leer los `sub`, migrar los datos de la app y recién entonces cambiar
`auth.config.ts`.

**Apps con un solo deployment que sirve de prod** (plan gratuito de Convex): no hay
un "dev" aparte donde ensayar. Usa el Core de prod con una app `<nombre>-test`
(`environment: "test"`, pool propio, `invite_only` con lista de correos) y migra la
app real solo cuando el flujo completo funcione contra la de test.

> **No verificado:** que Convex acepte el token de Gateward con `domain` y
> `applicationID` de punta a punta. Tampoco se ha probado con dos proveedores
> configurados a la vez. Valida con una app antes de dar esta guía por buena.

## Checklist

- [ ] App aprovisionada, `app_id` a mano
- [ ] Origen en `CORS_ALLOWED_ORIGINS` del Core
- [ ] Storage elegido (`createWebStorage`, + `withSessionMarker` si hay SSR)
- [ ] Provider montado, `status === "loading"` renderiza un spinner **y no** la
      pantalla de login
- [ ] `onSessionExpired` conectado al redirect
- [ ] Llamadas a tu API firmadas con `createFetch({ origins: [...] })`
- [ ] Backend verificando el JWT con `verifyToken`
- [ ] Rol de tu app leído de `metadata`, autorizado en el backend
- [ ] Usuarios existentes migrados (ver abajo) y datos remapeados al `sub` nuevo

## Migrar usuarios existentes

**Los hashes se importan.** No hace falta reset masivo ni mantener dos logins
en paralelo — que era el camino peligroso.

`POST /v1/admin/users/import` acepta:

| Formato | De dónde suele venir |
|---|---|
| Argon2 | apps que ya usaban Argon2 |
| bcrypt (`$2a$`, `$2b$`, `$2y$`) | Node, Convex, Rails |
| `pbkdf2_sha256$…` | Django |

El re-hash a Argon2id pasa solo, en el primer login de cada usuario: para el
usuario es transparente, escribe su contraseña de siempre. Cualquier otro
formato se rechaza **en el import**, no en el primer login, así que te enterás
al migrar y no cuando el usuario no pueda entrar.

Detalles operativos (máximo 200 por request, veredicto por fila, una fila mala
no tumba el lote) en la guía `docs/GUIDES/USER_MIGRATION.md` del Core.

Es superficie de admin, así que la corre un operador desde el dashboard — no la
app integrada, y por eso no está en este SDK.

> Para medir avance: contar usuarios cuyo `password_hash` no empiece con
> `$argon2`. Cuando llegue a cero, todos migraron.

Reimportar **nunca pisa credenciales vivas**, así que el import no sirve para
cambiar contraseñas — para eso está `forgotPassword()`.

## Ambientes de prueba

Hay un Core de stg y uno de prod, con bases y llaves separadas (ver
[Qué Core usa cada ambiente](../../README.md#qué-core-usa-cada-ambiente)). Dentro de
cada Core el aislamiento se arma con un identity pool propio y un app marcado
`environment: "test"`: los usuarios de QA quedan en otro pool y no tocan los reales.

Protege el build con la guarda del SDK:

```ts
new GatewardAuth({ baseUrl, appId, expectEnvironment: "test" });
```

En apps de test conviene `require_email_verification: false`: sin SMTP configurado
el token de verificación solo queda en los logs del Core y no hay forma de completar
el alta desde afuera.

La prueba que de verdad valida el aislamiento es la última del checklist del Core
(`docs/GUIDES/INTEGRATION_TESTING.md`): **el usuario de QA tiene que dar 401 contra
el `app_id` de producción.** Córrela antes de dar por buena una integración.

## Bloqueadores conocidos

| Bloqueador | A quién afecta |
|---|---|
| Sin SDK de Python | backends Django/DRF y FastAPI |

Es el único que queda. Ya están resueltos: política de password por app (una app
puede exigir un PIN numérico corto en vez del mínimo por defecto), auto-login en
el alta, perfil en el registro, asignación de `app_admin`, cambio de email, baja
de cuenta, e import de hashes legacy.

Están reportados al equipo del Core.
