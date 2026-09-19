// Descarga las actividades de Strava y las vuelca en data/strava.json
// en el mismo formato que usa index.html (state.activities).
//
// Variables de entorno requeridas:
//   STRAVA_CLIENT_ID
//   STRAVA_CLIENT_SECRET
//   STRAVA_REFRESH_TOKEN
// Opcional:
//   STRAVA_AFTER  (fecha ISO, por defecto 2025-06-01) - no se traen actividades anteriores

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN } = process.env;

if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET || !STRAVA_REFRESH_TOKEN) {
  console.error('Faltan STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET / STRAVA_REFRESH_TOKEN en el entorno.');
  process.exit(1);
}

const AFTER = process.env.STRAVA_AFTER || '2025-06-01';
const afterEpoch = Math.floor(new Date(AFTER + 'T00:00:00Z').getTime() / 1000);

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

async function getAccessToken() {
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      refresh_token: STRAVA_REFRESH_TOKEN,
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

async function main() {
  const accessToken = await getAccessToken();
  const raw = await fetchActivities(accessToken);
  const activities = raw
    .map(toAppActivity)
    .sort((x, y) => x.date.localeCompare(y.date));

  const out = { updatedAt: new Date().toISOString(), activities };
  const outPath = path.join(process.cwd(), 'data', 'strava.json');
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(out, null, 2) + '\n', 'utf8');

  console.log(`OK: ${activities.length} actividades escritas en data/strava.json`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
