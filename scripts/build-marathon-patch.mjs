// Construye el JSON de "ajuste" (formato que ya entiende applyPatch() en
// index.html) a partir del plan de maratón, para importarlo desde la
// pestaña Datos → "Aplicar ajuste". No toca la app ni el estado del
// usuario directamente: solo genera el archivo que luego se importa a mano.

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// [date, kind, title, details, expectedKm, hrCap]
const ROWS = [
  // Transición: 30 oct – 1 nov
  ['2026-10-30', 'quality', 'Series en pista', 'Pista con amigos: calentamiento + 6–8×800m en 3:32–3:36 (≈4:25–4:30/km), recuperación 1min o 200m trote + vuelta a la calma', 11, null],
  ['2026-10-31', 'easy', 'Rodaje suave', 'Rodaje suave a 5:20–5:40/km', 8, 148],
  ['2026-11-01', 'long', 'Rodaje largo suave', 'Rodaje largo suave a 5:20–5:30/km', 16, 152],

  // Semana 1 · 2–8 nov · ~63km
  ['2026-11-02', 'recovery', 'Regenerativo + pádel', 'Regenerativo a mediodía (5:30–5:50/km, <140ppm) + pádel 20:00', 5, 140],
  ['2026-11-03', 'quality', 'Series: 10×400m', '2km+técnica+10×400m a 1:30 (3:45/km), recuperación 200m trote +2km', 10, null],
  ['2026-11-04', 'easy', 'Rodaje suave + gym', 'Rodaje suave a 5:20–5:40/km + gimnasio (core/tren superior, pierna ligera)', 10, 148],
  ['2026-11-05', 'quality', 'Umbral: 3×2km', '2km+3×2km a umbral (8:30–8:40, 4:15–4:20/km), recuperación 2min trote +2km', 10.5, null],
  ['2026-11-06', 'rest', 'Descanso', 'Descanso total', 0, null],
  ['2026-11-07', 'easy', 'Rodaje suave', 'Rodaje suave a 5:20–5:40/km', 6, 148],
  ['2026-11-08', 'long', 'Tirada larga 22km', 'Tirada larga continua suave a 5:20–5:30/km', 22, 152],

  // Semana 2 · 9–15 nov · ~72km
  ['2026-11-09', 'recovery', 'Regenerativo + pádel', 'Regenerativo a mediodía (5:30–5:50/km, <140ppm) + pádel 20:00', 6, 140],
  ['2026-11-10', 'quality', 'Series: 6×800m', '2km+técnica+6×800m a 3:04 (3:50/km), recuperación 2min trote +2km', 11, null],
  ['2026-11-11', 'easy', 'Rodaje suave + gym', 'Rodaje suave a 5:20–5:40/km + gimnasio', 10, 148],
  ['2026-11-12', 'quality', 'Ritmo 10K: 5km continuos', '3km+5km a ritmo 10K continuos (19:35–20:00, 3:55–4:00/km) +3km', 11, null],
  ['2026-11-13', 'rest', 'Descanso', 'Descanso total', 0, null],
  ['2026-11-14', 'easy', 'Rodaje suave', 'Rodaje suave a 5:20–5:40/km', 8, 148],
  ['2026-11-15', 'long', 'Tirada larga 26km con RM', '20km suaves (5:20–5:30) + 6km a ritmo maratón (4:55–5:00). Primer ensayo de geles (km 8 y 16)', 26, 152],

  // Semana 3 · 16–22 nov · ~77km (pico)
  ['2026-11-16', 'recovery', 'Regenerativo + pádel', 'Regenerativo a mediodía (5:30–5:50/km, <140ppm) + pádel 20:00', 6, 140],
  ['2026-11-17', 'quality', 'Series: 5×1000m', '2km+técnica+5×1000m a 3:55, recuperación 2min trote +2km', 11, null],
  ['2026-11-18', 'easy', 'Rodaje suave + gym ligero', 'Rodaje suave a 5:20–5:40/km + gimnasio ligero', 12, 148],
  ['2026-11-19', 'quality', 'Umbral: 2×3km', '2km+2×3km a umbral (12:45–13:00, 4:15–4:20/km), recuperación 3min trote +2km', 12, null],
  ['2026-11-20', 'rest', 'Descanso', 'Descanso total', 0, null],
  ['2026-11-21', 'easy', 'Rodaje suave', 'Rodaje suave a 5:20–5:40/km', 6, 148],
  ['2026-11-22', 'long', 'Tirada larga 30km con RM (pico)', 'Semana más dura. 20km suaves (5:20–5:30) + 10km a ritmo maratón (4:55–5:00). Ensayo general: mismo desayuno, zapatillas, ropa y geles (km 8, 16, 24) que el día de carrera', 30, 152],

  // Semana 4 · 23–29 nov · ~56km (empieza bajada)
  ['2026-11-23', 'recovery', 'Regenerativo + pádel', 'Regenerativo a mediodía (5:30–5:50/km, <140ppm) + pádel 20:00', 5, 140],
  ['2026-11-24', 'quality', 'Series: 8×400m', '2km+técnica+8×400m a 1:30 (3:45/km), recuperación 200m trote +2km', 9, null],
  ['2026-11-25', 'easy', 'Rodaje suave', 'Rodaje suave a 5:20–5:40/km. Sin pierna en el gym desde esta semana', 8, 148],
  ['2026-11-26', 'quality', 'Umbral: 4km continuos', '3km+4km a umbral continuos (17:00–17:20, 4:15–4:20/km) +3km', 10, null],
  ['2026-11-27', 'rest', 'Descanso', 'Descanso total', 0, null],
  ['2026-11-28', 'easy', 'Rodaje suave', 'Rodaje suave a 5:20–5:40/km', 6, 148],
  ['2026-11-29', 'long', 'Tirada larga 18km', 'Tirada larga suave a 5:20–5:30/km (bajada de carga ~25%)', 18, 152],

  // Semana 5 · 30 nov – 6 dic · semana de carrera
  ['2026-11-30', 'rest', 'Descanso (sin pádel)', 'Descanso total, sin pádel esta semana', 0, null],
  ['2026-12-01', 'specific', 'Ritmo específico: 3×1000m RM', '2km+3×1000m a ritmo maratón (5:00/km)+4×400m sueltos (1:35), recuperación 1min trote +1km', 8, null],
  ['2026-12-02', 'easy', 'Rodaje suave', 'Rodaje suave a 5:20–5:40/km', 6, 148],
  ['2026-12-03', 'rest', 'Descanso', 'Descanso total', 0, null],
  ['2026-12-04', 'easy', 'Rodaje suave + rectas', 'Rodaje suave a 5:20–5:40/km + 4×80m progresivos', 5, 148],
  ['2026-12-05', 'activation', 'Activación + carga de hidratos', 'Activación 15–20min suave + carga de hidratos', 3, 140],
  ['2026-12-06', 'race', 'MARATÓN VALENCIA', '42,2km a ritmo objetivo 4:55–5:00/km (meta 3:31:00). Desayuno 5:15: pan blanco+mermelada/miel+plátano+café. Km1-5 a 5:05-5:10. Km5-35 a 4:57-5:00 (pulso <152). Geles en km 8,16,24,32. Km35-42: deja salir el ritmo si vas bien, si no mantén 5:00', 42.2, null],
];

// renderPlan() en index.html agrupa las sesiones por el campo `week` y usa
// `day` como etiqueta de columna — sin esto, todas las sesiones caen en un
// único bloque "semana undefined". `phase` es el título de cada bloque
// semanal (lo usa renderPlan si existe; si no, cae en su lógica antigua).
const DAY_ABBR = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const PHASE_BY_WEEK = {
  0: 'Transición desde la media',
  1: 'Vuelta al volumen',
  2: 'Umbral + ritmo maratón',
  3: 'Pico de volumen',
  4: 'Bajada de carga',
  5: 'Semana de carrera',
};
function weekNumber(date) {
  if (date < '2026-11-02') return 0; // transición
  if (date < '2026-11-09') return 1;
  if (date < '2026-11-16') return 2;
  if (date < '2026-11-23') return 3;
  if (date < '2026-11-30') return 4;
  return 5;
}

const plan = ROWS.map(([date, kind, title, details, expectedKm, hrCap]) => {
  const week = weekNumber(date);
  return {
    date,
    week,
    day: DAY_ABBR[new Date(date + 'T12:00:00').getDay()],
    phase: PHASE_BY_WEEK[week],
    kind,
    title,
    details,
    source: 'coach',
    expectedKm,
    hrCap,
  };
});

const patch = {
  plan,
  planVersion: 'Coach · Maratón Valencia · 30/10 · plan importado (transición + 5 semanas)',
  coachNote:
    'Plan de maratón importado: objetivo 3:31:00 (5:00/km) en el Maratón de Valencia del 6 de diciembre de 2026, ' +
    'con bloque de velocidad después para una 10K sub-40. Estructura fija: lunes regenerativo + pádel, martes series, ' +
    'miércoles suave (+gym), jueves ritmo, viernes descanso, sábado suave, domingo tirada larga. Pico de volumen en la ' +
    'semana 3 (~77km, tirada de 30km). Si aparece una molestia: quita primero los km del sábado, luego los del miércoles — ' +
    'la tirada larga es lo último que se toca.',
};

// Copia con fecha (histórico/auditoría) + copia "viva" en data/coach-plan.json,
// que es la que la propia web consulta sola (ver syncCoachPlan() en index.html).
const archivePath = path.join(process.cwd(), 'coach-patches', '2026-10-30-plan-maraton-valencia.json');
const livePath = path.join(process.cwd(), 'data', 'coach-plan.json');
const json = JSON.stringify(patch, null, 2) + '\n';

await mkdir(path.dirname(archivePath), { recursive: true });
await mkdir(path.dirname(livePath), { recursive: true });
await writeFile(archivePath, json, 'utf8');
await writeFile(livePath, json, 'utf8');
console.log(`OK: ${plan.length} sesiones escritas en ${archivePath} y ${livePath}`);
