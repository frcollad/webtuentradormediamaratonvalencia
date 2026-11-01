# Sync de Strava en Cloudflare Workers

Hace lo mismo que `scripts/update-strava.mjs`, pero corre en la nube con un
Cron Trigger real (cada 10 min, cumplido con precisión) en vez de depender
de tu PC o del cron de GitHub Actions. Escribe `data/strava.json`
directamente en el repo vía la API de GitHub.

## Pasos (los haces tú, cada uno pide tu login/consentimiento)

### 1. Cuenta de Cloudflare + login de wrangler

```powershell
cd cloudflare\strava-sync
npx wrangler login
```

Se abrirá el navegador. Si no tienes cuenta de Cloudflare, puedes crearla
ahí mismo gratis.

### 2. Token de GitHub (para que el Worker pueda escribir en el repo)

1. Ve a https://github.com/settings/personal-access-tokens/new
2. **Repository access**: "Only select repositories" → elige
   `webtuentradormediamaratonvalencia`
3. **Permissions** → **Repository permissions** → **Contents**: `Read and write`
4. Genera el token y cópialo (empieza por `github_pat_...`)

### 3. Configurar los secrets del Worker

Desde `cloudflare\strava-sync`, uno por uno (te pedirá pegar el valor,
no se queda en el historial de la terminal):

```powershell
npx wrangler secret put STRAVA_CLIENT_ID
npx wrangler secret put STRAVA_CLIENT_SECRET
npx wrangler secret put STRAVA_REFRESH_TOKEN
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put TRIGGER_KEY
```

(`TRIGGER_KEY` es cualquier cadena que te inventes — sirve para poder
lanzar una sincronización manual visitando la URL del Worker con
`?key=esa_cadena`, sin esperar al cron.)

### 4. Desplegar

```powershell
npx wrangler deploy
```

Esto imprime la URL del Worker (algo como
`https://tuentrenador-strava-sync.<tu-usuario>.workers.dev`). Pruébala
visitando `<esa URL>?key=<tu TRIGGER_KEY>` — debería devolver un JSON con
`"changed"` y `"count"`.

### 5. Comprobar que el cron está activo

En el dashboard de Cloudflare → Workers & Pages → tuentrenador-strava-sync
→ Triggers, deberías ver el cron `*/10 * * * *`. También puedes ver los
logs en vivo con:

```powershell
npx wrangler tail
```

## Desarrollo local (opcional)

Copia `.dev.vars.example` a `.dev.vars`, rellénalo, y:

```powershell
npm run dev
```
