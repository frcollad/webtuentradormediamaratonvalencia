#!/usr/bin/env python3
"""
Descarga datos de bienestar de Garmin Connect (FC en reposo, sueño, Body
Battery, estrés, HRV y Training Readiness) y los vuelca en data/garmin.json,
en el mismo espíritu que scripts/update-strava.mjs para las actividades.

Requiere tener ya una sesión guardada con scripts/garmin_login.py
(en ~/.garminconnect). Si no la encuentra, no pide contraseña: avisa y
termina, para poder correr sin supervisión (tarea programada).

Uso:
  python scripts/update-garmin.py
Variables de entorno opcionales:
  GARMIN_DAYS   días hacia atrás a descargar (por defecto 60)
"""

import json
import os
import sys
from datetime import date, datetime, timedelta, timezone

from garminconnect import Garmin

TOKENSTORE = os.path.expanduser("~/.garminconnect")
DAYS = int(os.environ.get("GARMIN_DAYS", "60"))


def safe(fn, *args):
    """Llama a fn(*args); si falla (endpoint caído, dato no disponible para
    esa cuenta/reloj, etc.) avisa y sigue con el resto en vez de abortar todo."""
    try:
        return fn(*args) or []
    except Exception as e:
        print(f"Aviso: falló {fn.__name__}: {e}")
        return []


def date_chunks(start, end, max_days=28):
    """Algunos endpoints de Garmin rechazan rangos de más de 28 días."""
    cur = start
    while cur <= end:
        chunk_end = min(end, cur + timedelta(days=max_days - 1))
        yield cur, chunk_end
        cur = chunk_end + timedelta(days=1)


def fetch_range(fn, start, end):
    """Pide fn(start, end) troceado en ventanas de 28 días y concatena las listas."""
    items = []
    for cs, ce in date_chunks(start, end):
        items.extend(safe(fn, cs.isoformat(), ce.isoformat()))
    return items


def main():
    garmin = Garmin()
    try:
        garmin.login(TOKENSTORE)
    except Exception as e:
        print(f"No se pudo iniciar sesión con la sesión guardada: {e}")
        print("Ejecuta 'python scripts/garmin_login.py' para volver a iniciar sesión.")
        sys.exit(1)

    end = date.today()
    start = end - timedelta(days=DAYS - 1)

    by_date = {}

    def put(d, **fields):
        if not d:
            return
        row = by_date.setdefault(d, {"date": d})
        row.update({k: v for k, v in fields.items() if v is not None})

    for item in fetch_range(garmin.get_rhr_daily, start, end):
        put(item.get("calendarDate"), restingHr=item.get("value"))

    for item in fetch_range(garmin.get_sleep_daily, start, end):
        v = item.get("values") or {}
        put(
            item.get("calendarDate"),
            sleepSeconds=v.get("totalSleepTimeInSeconds"),
            sleepScore=v.get("sleepScore"),
            sleepQuality=v.get("sleepScoreQuality"),
            hrvStatus=v.get("hrvStatus"),
            hrvLastNight=v.get("avgOvernightHrv"),
            hrv7dAvg=v.get("hrv7dAverage"),
        )

    for item in fetch_range(garmin.get_daily_stress_stats, start, end):
        v = item.get("values") or {}
        put(item.get("calendarDate"), stressAvg=v.get("overallStressLevel"))

    for item in fetch_range(garmin.get_daily_body_battery_stats, start, end):
        v = item.get("values") or {}
        put(
            item.get("calendarDate"),
            bodyBatteryLow=v.get("lowBodyBattery"),
            bodyBatteryHigh=v.get("highBodyBattery"),
        )

    for cs, ce in date_chunks(start, end):
        hrv_range = safe(garmin.get_hrv_data_range, cs.isoformat(), ce.isoformat())
        if isinstance(hrv_range, dict):
            for item in hrv_range.get("hrvSummaries") or []:
                put(
                    item.get("calendarDate"),
                    hrvStatus=item.get("status"),
                    hrvLastNight=item.get("lastNightAvg"),
                    hrv7dAvg=item.get("weeklyAvg"),
                )

    for item in fetch_range(garmin.get_training_readiness_range, start, end):
        put(
            item.get("calendarDate"),
            readinessScore=item.get("score"),
            readinessLevel=item.get("level"),
        )

    days = [by_date[d] for d in sorted(by_date)]
    out = {"updatedAt": datetime.now(timezone.utc).isoformat(), "days": days}

    out_path = os.path.join(os.path.dirname(__file__), "..", "data", "garmin.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"OK: {len(days)} días escritos en data/garmin.json")


if __name__ == "__main__":
    main()
