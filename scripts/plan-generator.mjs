// Generador de planes de entrenamiento de running — algoritmo puro.
//
// Objetivo de este archivo: comprobar si la lógica de "a partir de un
// objetivo + disponibilidad + forma física actual, calcula un plan
// razonable" se sostiene, ANTES de pensar en multiusuario/backend/etc.
//
// No depende de la app (index.html), de localStorage ni de red: son
// funciones puras que se pueden probar con datos reales (ver el bloque
// CLI al final, que usa data/strava.json).
//
// Periodización (simplificada, inspirada en esquemas clásicos tipo
// Daniels/Pfitzinger, no es ciencia exacta):
//   base (fartlek) → umbral (tempo) → series (VO2max) → específico
//   (ritmo de carrera) → tapering
// con una semana de descarga cada 4 (-25% volumen) y una progresión de
// volumen semanal acotada (no más de ~8%/semana).

// ---------- utilidades de tiempo/ritmo ----------

export function parseTime(hms) {
  const p = String(hms).split(':').map(Number);
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return p[0];
}

export function fmtTime(totalSec) {
  const sec = Math.round(totalSec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function fmtPace(secPerKm) {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')}/km`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const WEEKDAY_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
function weekdayEs(dateStr) {
  return WEEKDAY_ES[new Date(dateStr + 'T12:00:00').getDay()];
}

// Predicción de tiempo objetivo a partir de un esfuerzo conocido
// (fórmula de Riegel, misma que ya usa index.html para la predicción de media).
export function riegelPredict(knownDistKm, knownTimeSec, targetDistKm) {
  return knownTimeSec * Math.pow(targetDistKm / knownDistKm, 1.06);
}

// ---------- estimar forma física actual a partir de actividades reales ----------

/**
 * @param {Array} activities actividades en formato de la app (sport, distance en m, duration en s, localDate)
 * @param {number} goalDistanceKm distancia objetivo (ej. 21.0975 para media maratón)
 * @param {string} asOf fecha ISO (YYYY-MM-DD) desde la que mirar hacia atrás
 * @param {number} windowDays ventana hacia atrás (por defecto 56 días = 8 semanas)
 */
export function estimateFitness(activities, goalDistanceKm, asOf, windowDays = 56) {
  const asOfDate = new Date(asOf + 'T12:00:00');
  const windowStart = new Date(asOfDate);
  windowStart.setDate(windowStart.getDate() - windowDays);

  const runs = activities.filter((a) => {
    if (a.sport !== 'running' || !(a.distance >= 4000) || !(a.duration > 0)) return false;
    const d = new Date(a.localDate + 'T12:00:00');
    return d >= windowStart && d <= asOfDate;
  });

  const weeks = windowDays / 7;
  const weeklyKm = runs.reduce((s, a) => s + a.distance, 0) / 1000 / weeks;
  const longestRecentKm = runs.length ? Math.max(...runs.map((a) => a.distance / 1000)) : 0;

  // Predicción del tiempo en la distancia objetivo a partir de cada carrera
  // reciente (vía Riegel), usando el percentil ~10 (cerca del mejor esfuerzo
  // real sin dejarse engañar por una sola carrera suelta/outlier de GPS).
  const predictions = runs
    .map((a) => riegelPredict(a.distance / 1000, a.duration, goalDistanceKm))
    .sort((a, b) => a - b);
  const idx = Math.max(0, Math.floor(predictions.length * 0.1));
  const predictedGoalTime = predictions.length ? predictions[idx] : null;

  return { weeklyKm, longestRecentKm, predictedGoalTime, sampleSize: runs.length };
}

// ---------- ¿es realista el objetivo? ----------

/**
 * Compara el tiempo objetivo con lo que predicen las carreras recientes y
 * con el tiempo disponible de entrenamiento, usando una tasa de mejora
 * conservadora (~1.5% de ritmo cada 4 semanas de entrenamiento serio).
 * Es una heurística simple, no un modelo fisiológico — pero evita que el
 * generador calcule un plan "bonito" para un objetivo que no es alcanzable.
 */
export function assessFeasibility(currentFitness, goalDistanceKm, targetTimeSec, totalWeeks) {
  if (!currentFitness.predictedGoalTime) {
    return { verdict: 'unknown', message: 'No hay suficientes carreras recientes para valorar si el objetivo es realista.' };
  }
  const predictedPace = currentFitness.predictedGoalTime / goalDistanceKm;
  const targetPace = targetTimeSec / goalDistanceKm;
  const requiredImprovement = (predictedPace - targetPace) / predictedPace; // positivo = hay que mejorar
  const maxRealisticImprovement = 0.015 * (totalWeeks / 4);

  if (requiredImprovement > maxRealisticImprovement) {
    const monthsNeeded = Math.ceil((requiredImprovement / 0.015) * 4 / 4.345);
    return {
      verdict: 'too_ambitious',
      requiredImprovementPct: requiredImprovement * 100,
      message:
        `Objetivo muy ambicioso: tu nivel actual predice ${fmtTime(currentFitness.predictedGoalTime)}, ` +
        `y para bajar a ${fmtTime(targetTimeSec)} en ${totalWeeks} semanas habría que mejorar el ritmo un ` +
        `${(requiredImprovement * 100).toFixed(1)}% — más de lo que es razonable de forma segura en ese plazo ` +
        `(orientativamente harían falta unos ${monthsNeeded} meses). Se genera el plan igualmente, pero el ritmo ` +
        `de las sesiones está calculado para un objetivo que probablemente no te vas a poder permitir sin riesgo de lesión.`,
    };
  }
  if (requiredImprovement < -0.02) {
    return {
      verdict: 'conservative',
      requiredImprovementPct: requiredImprovement * 100,
      message: `Objetivo conservador: tu nivel actual (${fmtTime(currentFitness.predictedGoalTime)}) ya es más rápido que el objetivo (${fmtTime(targetTimeSec)}). Podrías plantear algo más ambicioso.`,
    };
  }
  return {
    verdict: 'realistic',
    requiredImprovementPct: requiredImprovement * 100,
    message: `Objetivo razonable dado tu nivel actual y el tiempo disponible.`,
  };
}

// ---------- generación del plan ----------

const QUALITY_BY_PHASE = {
  base: {
    kind: 'fartlek',
    title: 'Fartlek',
    detail: (p) => `Fartlek: 8×2' fuerte / 2' suave, los fuertes a ritmo ${fmtPace(p.tempo)}`,
    fraction: 0.18,
  },
  threshold: {
    kind: 'quality',
    title: 'Tempo',
    detail: (p) => `Tempo continuo: 20-25' a ritmo ${fmtPace(p.tempo)}`,
    fraction: 0.2,
  },
  vo2: {
    kind: 'quality',
    title: 'Series',
    detail: (p) => `Series: 6×1000m a ritmo ${fmtPace(p.interval)} con 2' trote suave de recuperación`,
    fraction: 0.22,
  },
  specific: {
    kind: 'specific',
    title: 'Ritmo específico',
    detail: (p) => `Ritmo específico: 3×2km a ritmo objetivo ${fmtPace(p.race)} con 3' trote`,
    fraction: 0.22,
  },
  taper: {
    kind: 'activation',
    title: 'Activación',
    detail: () => `Activación: 20' suave + 4×100m progresivos`,
    fraction: 0.1,
  },
};

function phaseForWeek(weekIndex, buildWeeks) {
  const frac = weekIndex / buildWeeks;
  if (frac < 0.3) return 'base';
  if (frac < 0.55) return 'threshold';
  if (frac < 0.85) return 'vo2';
  return 'specific';
}

function sessionKindsForDays(daysPerWeek) {
  // orden cronológico dentro de la semana; 'Q' se sustituye por la fase correspondiente
  if (daysPerWeek <= 1) return ['long'];
  if (daysPerWeek === 2) return ['easy', 'long'];
  if (daysPerWeek === 3) return ['easy', 'Q', 'long'];
  if (daysPerWeek === 4) return ['easy', 'Q', 'easy', 'long'];
  if (daysPerWeek === 5) return ['easy', 'Q', 'easy', 'easy', 'long'];
  return ['easy', 'Q', 'easy', 'hills', 'easy', 'long'];
}

/**
 * Genera un plan de entrenamiento de running.
 *
 * @param {object} opts
 * @param {string} opts.today        fecha ISO de inicio del plan
 * @param {string} opts.raceDate     fecha ISO de la carrera objetivo
 * @param {number} opts.goalDistanceKm distancia de la carrera (ej. 21.0975)
 * @param {number} [opts.targetTimeSec] tiempo objetivo en segundos; si no se da, se usa la predicción de forma física actual
 * @param {number} opts.daysPerWeek  días de entrenamiento disponibles por semana (1-6)
 * @param {string[]} opts.preferredDays códigos de día ('mon'...'sun'), en el orden que prefiera el usuario; se usan los primeros `daysPerWeek`, ordenados cronológicamente dentro de la semana
 * @param {object} [opts.athlete]   { age, weightKg, heightCm } — age se usa para la FC máx. estimada; peso/altura se guardan en el perfil pero no afectan (todavía) al cálculo
 * @param {object} opts.currentFitness salida de estimateFitness()
 */
export function generatePlan(opts) {
  const {
    today,
    raceDate,
    goalDistanceKm,
    targetTimeSec,
    daysPerWeek,
    preferredDays,
    athlete = {},
    currentFitness,
  } = opts;

  const totalDays = Math.round((new Date(raceDate + 'T12:00:00') - new Date(today + 'T12:00:00')) / 86400000);
  if (totalDays < 7) throw new Error('La fecha de la carrera debe ser al menos una semana después de hoy.');
  const totalWeeks = Math.max(4, Math.ceil(totalDays / 7));
  const taperWeeks = totalWeeks >= 8 ? 2 : totalWeeks >= 5 ? 1 : 0;
  const buildWeeks = totalWeeks - taperWeeks;

  const goalTime = targetTimeSec || currentFitness.predictedGoalTime;
  if (!goalTime) throw new Error('No se pudo estimar un tiempo objetivo: faltan datos recientes y no se dio targetTimeSec.');
  const feasibility = assessFeasibility(currentFitness, goalDistanceKm, goalTime, totalWeeks);
  const racePace = goalTime / goalDistanceKm;
  const paces = {
    race: racePace,
    interval: racePace - 18,
    tempo: racePace + 12,
    steady: racePace + 35,
    long: racePace + 55,
    easy: racePace + 70,
  };

  const maxHr = athlete.age ? 220 - athlete.age : null;

  const DAY_CODE = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };
  const chosenDays = [...new Set(preferredDays)].slice(0, daysPerWeek).sort((a, b) => {
    const ca = DAY_CODE[a], cb = DAY_CODE[b];
    return ((ca + 6) % 7) - ((cb + 6) % 7); // semana empieza en lunes
  });
  if (chosenDays.length < daysPerWeek) {
    throw new Error(`Se pidieron ${daysPerWeek} días/semana pero solo se dieron ${preferredDays.length} días preferidos distintos.`);
  }

  const startWeeklyKm = Math.max(12, currentFitness.weeklyKm || 15);
  const peakWeeklyKm = Math.min(startWeeklyKm * 1.7, Math.max(startWeeklyKm * 1.15, goalDistanceKm * 1.8));

  const kindPattern = sessionKindsForDays(daysPerWeek);
  const mondayOfWeek = (dateStr) => {
    const d = new Date(dateStr + 'T12:00:00');
    const diff = (d.getDay() + 6) % 7; // 0 = lunes
    return addDays(dateStr, -diff);
  };
  // El plan arranca siempre en lunes, para no generar sesiones en días que
  // ya han pasado: si "today" no es lunes, se empieza el lunes siguiente.
  const thisMonday = mondayOfWeek(today);
  const weekStart0 = thisMonday === today ? today : addDays(thisMonday, 7);

  let rampKm = startWeeklyKm;
  const weeks = [];

  for (let w = 1; w <= totalWeeks; w++) {
    const weekMonday = addDays(weekStart0, (w - 1) * 7);
    const isTaper = w > buildWeeks;
    const isCutback = !isTaper && w % 4 === 0;

    let targetKm;
    if (isTaper) {
      const taperIndex = w - buildWeeks; // 1..taperWeeks
      targetKm = Math.max(peakWeeklyKm * 0.4, peakWeeklyKm * (1 - taperIndex * 0.35));
    } else if (isCutback) {
      targetKm = rampKm * 0.75;
    } else {
      targetKm = Math.min(peakWeeklyKm, rampKm * 1.08);
      rampKm = targetKm;
    }

    const phase = isTaper ? 'taper' : phaseForWeek(w, buildWeeks);
    const quality = QUALITY_BY_PHASE[phase];

    const longFraction = isTaper ? 0.3 : 0.35;
    const longKm = Math.min(targetKm * longFraction, isTaper ? 14 : Math.max(10, goalDistanceKm * 0.95));
    const qualityKm = targetKm * quality.fraction;
    const remaining = Math.max(0, targetKm - longKm - qualityKm);
    const easySlots = kindPattern.filter((k) => k === 'easy' || k === 'hills').length;
    const easyKm = easySlots ? remaining / easySlots : 0;

    const sessions = chosenDays.map((dayCode, i) => {
      const date = addDays(weekMonday, DAY_CODE[dayCode] === 0 ? 6 : DAY_CODE[dayCode] - 1);
      const kind = kindPattern[i];

      if (kind === 'long') {
        const isRaceWeek = w === totalWeeks;
        return {
          date,
          weekday: weekdayEs(date),
          kind: isRaceWeek ? 'race' : 'long',
          title: isRaceWeek ? 'Carrera objetivo' : 'Tirada larga',
          details: isRaceWeek
            ? `Día de carrera: ${goalDistanceKm.toFixed(1)}km a ritmo objetivo ${fmtPace(paces.race)} (meta ${fmtTime(goalTime)})`
            : `Tirada larga continua a ritmo ${fmtPace(paces.long)}${!isTaper ? `, últimos 2-3km hacia ${fmtPace(paces.steady)} si vienes fresco` : ''}`,
          expectedKm: Math.round((isRaceWeek ? goalDistanceKm : longKm) * 10) / 10,
          hrCap: maxHr ? Math.round(maxHr * (isTaper ? 0.82 : 0.78)) : null,
        };
      }
      if (kind === 'Q' || kind === 'hills') {
        const q = kind === 'hills' && !isTaper ? { kind: 'hills', title: 'Cuestas', detail: () => `Cuestas: 8×40" subida fuerte, bajada trotando`, fraction: 0.12 } : quality;
        const km = kind === 'hills' ? targetKm * 0.12 : qualityKm;
        return {
          date,
          weekday: weekdayEs(date),
          kind: q.kind,
          title: q.title,
          details: q.detail(paces),
          expectedKm: Math.round(km * 10) / 10,
          hrCap: null,
        };
      }
      // easy
      return {
        date,
        weekday: weekdayEs(date),
        kind: 'easy',
        title: 'Rodaje suave',
        details: `Rodaje suave y conversacional a ritmo ${fmtPace(paces.easy)}`,
        expectedKm: Math.round(easyKm * 10) / 10,
        hrCap: maxHr ? Math.round(maxHr * 0.75) : null,
      };
    });

    weeks.push({
      week: w,
      weekStart: weekMonday,
      phase,
      isCutback,
      isTaper,
      targetKm: Math.round(targetKm * 10) / 10,
      sessions,
    });
  }

  return {
    profile: { ...athlete, maxHr },
    goal: { distanceKm: goalDistanceKm, raceDate, targetTimeSec: goalTime, targetPaceSecPerKm: racePace },
    feasibility,
    paces,
    totalWeeks,
    buildWeeks,
    taperWeeks,
    weeks,
  };
}

// ---------- CLI de prueba: genera un plan a partir de tus datos reales de Strava ----------

const { pathToFileURL } = await import('node:url');
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const { readFileSync } = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  const stravaPath = path.join(__dirname, '..', 'data', 'strava.json');
  const strava = JSON.parse(readFileSync(stravaPath, 'utf8'));

  const today = new Date().toISOString().slice(0, 10);
  const GOAL_DISTANCE_KM = 21.0975;

  const fitness = estimateFitness(strava.activities, GOAL_DISTANCE_KM, today);

  console.log('=== Forma física estimada (últimas 8 semanas, datos reales de Strava) ===');
  console.log(`Volumen semanal medio: ${fitness.weeklyKm.toFixed(1)} km`);
  console.log(`Tirada más larga reciente: ${fitness.longestRecentKm.toFixed(1)} km`);
  console.log(`Carreras usadas para la predicción: ${fitness.sampleSize}`);
  console.log(
    fitness.predictedGoalTime
      ? `Predicción de media maratón: ${fmtTime(fitness.predictedGoalTime)} (${fmtPace(fitness.predictedGoalTime / GOAL_DISTANCE_KM)})`
      : 'No hay suficientes carreras recientes para predecir.'
  );

  // Nota: la carrera real del proyecto (25/10/2026) ya ha pasado respecto a
  // "hoy" en esta sesión. Para la prueba usamos una fecha objetivo futura
  // (hoy + 12 semanas) y el tiempo objetivo real del proyecto (sub-90).
  const raceDate = addDays(today, 12 * 7);
  const targetTimeSec = parseTime('1:29:59');

  const plan = generatePlan({
    today,
    raceDate,
    goalDistanceKm: GOAL_DISTANCE_KM,
    targetTimeSec,
    daysPerWeek: 4,
    preferredDays: ['tue', 'thu', 'sat', 'sun'],
    athlete: { age: 35 },
    currentFitness: fitness,
  });

  console.log(`\n=== Plan generado: ${plan.totalWeeks} semanas (${plan.buildWeeks} de carga + ${plan.taperWeeks} de descarga), objetivo ${fmtTime(plan.goal.targetTimeSec)} (${fmtPace(plan.goal.targetPaceSecPerKm)}) ===`);
  console.log(`[${plan.feasibility.verdict}] ${plan.feasibility.message}\n`);

  for (const week of plan.weeks) {
    const tag = week.isTaper ? 'TAPER' : week.isCutback ? 'descarga' : week.phase;
    console.log(`Semana ${week.week} (${week.weekStart}) · ${week.targetKm}km · fase: ${tag}`);
    for (const s of week.sessions) {
      console.log(`  ${s.weekday.padEnd(10)} ${s.date}  [${s.kind.padEnd(10)}] ${s.expectedKm}km — ${s.details}`);
    }
  }
}
