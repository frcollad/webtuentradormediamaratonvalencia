// Worker de Cloudflare: hace exactamente lo mismo que scripts/update-strava.mjs
// (descargar actividades de Strava, convertirlas al formato de la app) pero
// corre en la nube con un Cron Trigger real -- sin depender de que tu PC
// esté encendido ni del cron de GitHub Actions (que no cumple el horario).
//
// En vez de "git commit", escribe data/strava.json directamente en el repo
// de GitHub usando la API de contenidos (GET para el sha actual + PUT con
// el contenido nuevo), autenticado con un token de GitHub guardado como
// secret de Cloudflare.

const OWNER = 'frcollad';
const REPO = 'webtuentradormediamaratonvalencia';
const BRANCH = 'main';
const FILE_PATH = 'data/strava.json';
const AFTER = '2025-06-01';

const SPORT_MAP = {
  Run: 'running',
  TrailRun: 'running',
  VirtualRun: 'running',
  Ride: 'cycling',
  VirtualRide: 'cycling',
  MountainBikeRide: 'cycling',
  GravelRide: 'cycling',
  EBikeRide: 'cycling',
  Swim: 'swimming',
  Walk: 'walking',
  Hike: 'hiking',
  Tennis: 'tennis',
  WeightTraining: 'strength',
  Workout: 'training',
  Crossfit: 'training',
  Yoga: 'training',
};

function mapSport(activity) {
  const key = activity.sport_type || activity.type || '';
  return SPORT_MAP[key] || 'other';
}

async function getAccessToken(env) {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      refresh_token: env.STRAVA_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new Error(`No se pudo renovar el token de Strava: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function fetchActivities(accessToken) {
  const all = [];
  const perPage = 200;
  const afterEpoch = Math.floor(new Date(AFTER + 'T00:00:00Z').getTime() / 1000);
  for (let page = 1; page <= 10; page++) {
    const url = `https://www.strava.com/api/v3/athlete/activities?after=${afterEpoch}&per_page=${perPage}&page=${page}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      throw new Error(`Error al listar actividades (página ${page}): ${res.status} ${await res.text()}`);
    }
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < perPage) break;
  }
  return all;
}

function toAppActivity(a) {
  const sport = mapSport(a);
  const distance = typeof a.distance === 'number' ? a.distance : 0;
  const duration = typeof a.moving_time === 'number' ? a.moving_time : 0;
  let avgCad = typeof a.average_cadence === 'number' ? a.average_cadence : null;
  if (avgCad != null && sport === 'running') avgCad = Math.round(avgCad * 2);

  return {
    id: `strava-${a.id}`,
    date: a.start_date,
    localDate: (a.start_date_local || a.start_date).slice(0, 10),
    title: a.name || (sport === 'running' ? 'Carrera' : 'Actividad'),
    sport,
    source: 'strava',
    distance,
    duration,
    elapsed: typeof a.elapsed_time === 'number' ? a.elapsed_time : duration,
    pace: distance ? duration / (distance / 1000) : null,
    avgHr: typeof a.average_heartrate === 'number' ? a.average_heartrate : null,
    maxHr: typeof a.max_heartrate === 'number' ? a.max_heartrate : null,
    avgCad,
    maxCad: null,
    ascent: typeof a.total_elevation_gain === 'number' ? a.total_elevation_gain : null,
    descent: null,
    avgPower: typeof a.average_watts === 'number' ? a.average_watts : null,
    maxPower: typeof a.max_watts === 'number' ? a.max_watts : null,
    laps: [],
  };
}

function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'tuentrenador-strava-sync-worker',
  };
}

async function getCurrentFile(env) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`;
  const res = await fetch(url, { headers: ghHeaders(env) });
  if (res.status === 404) return { sha: null, activities: null };
  if (!res.ok) throw new Error(`GitHub GET falló: ${res.status} ${await res.text()}`);
  const data = await res.json();
  // data.content viene en base64 (con saltos de línea); lo decodificamos para comparar.
  const decoded = new TextDecoder().decode(
    Uint8Array.from(atob(data.content.replace(/\n/g, '')), (c) => c.charCodeAt(0))
  );
  let activities = null;
  try {
    activities = JSON.parse(decoded).activities;
  } catch {
    // archivo corrupto/ilegible: lo tratamos como si no existiera y lo sobrescribimos
  }
  return { sha: data.sha, activities };
}

function base64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function putFile(env, contentStr, sha) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`;
  const body = {
    message: 'chore: sync Strava activities (cloudflare)',
    content: base64EncodeUtf8(contentStr),
    branch: BRANCH,
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...ghHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub PUT falló: ${res.status} ${await res.text()}`);
  return res.json();
}

async function syncStrava(env) {
  const accessToken = await getAccessToken(env);
  const raw = await fetchActivities(accessToken);
  const activities = raw.map(toAppActivity).sort((a, b) => a.date.localeCompare(b.date));

  const current = await getCurrentFile(env);
  const unchanged = current.activities && JSON.stringify(current.activities) === JSON.stringify(activities);
  if (unchanged) {
    return { changed: false, count: activities.length };
  }

  const out = { updatedAt: new Date().toISOString(), activities };
  await putFile(env, JSON.stringify(out, null, 2) + '\n', current.sha);
  return { changed: true, count: activities.length };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      syncStrava(env)
        .then((r) => console.log('sync ok', JSON.stringify(r)))
        .catch((e) => console.error('sync failed', e))
    );
  },

  // Permite lanzarlo a mano visitando la URL del Worker (para probar sin
  // esperar al cron), protegido con una clave simple.
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!env.TRIGGER_KEY || url.searchParams.get('key') !== env.TRIGGER_KEY) {
      return new Response('forbidden', { status: 403 });
    }
    try {
      const result = await syncStrava(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e) {
      return new Response(String(e && e.message ? e.message : e), { status: 500 });
    }
  },
};
