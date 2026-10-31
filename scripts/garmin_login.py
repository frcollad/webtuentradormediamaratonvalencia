#!/usr/bin/env python3
"""
Conecta tu cuenta de Garmin Connect a este equipo usando python-garminconnect.

Qué hace:
  1. Si ya hay una sesión guardada en ~/.garminconnect, la reutiliza (no pide nada).
  2. Si no hay sesión guardada (o ha caducado), te pide tu email y contraseña
     de Garmin AQUI MISMO en la terminal (no se envían a ningún otro sitio
     salvo a los servidores de Garmin, vía la librería garminconnect).
  3. Si tu cuenta tiene verificación en dos pasos (MFA), te pedirá el código
     en el momento en que Garmin lo exija.
  4. Guarda la sesión en ~/.garminconnect para que las próximas veces
     (y los scripts automáticos) no tengan que volver a pedir contraseña.
  5. Hace una llamada de prueba a la API para confirmar que todo funciona.

Uso:
  python scripts/garmin_login.py
"""

import getpass
import os
import sys

from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectTooManyRequestsError,
)

TOKENSTORE = os.path.expanduser("~/.garminconnect")


def get_mfa():
    return input("Código de verificación en dos pasos (MFA): ").strip()


def attempt_login(email=None, password=None):
    garmin = Garmin(email=email, password=password, is_cn=False, prompt_mfa=get_mfa)
    garmin.login(TOKENSTORE)
    return garmin


def main():
    have_tokens = os.path.isdir(TOKENSTORE) and bool(os.listdir(TOKENSTORE))

    garmin = None
    reused_session = False
    if have_tokens:
        try:
            garmin = attempt_login()
            reused_session = True
        except Exception:
            garmin = None  # tokens caducados o inválidos: pedimos credenciales abajo

    if garmin is None:
        print("Vamos a iniciar sesión con tu cuenta de Garmin.")
        email = input("Email de Garmin Connect: ").strip()
        password = getpass.getpass("Contraseña de Garmin Connect (no se mostrará): ")
        try:
            garmin = attempt_login(email, password)
        except GarminConnectAuthenticationError:
            print("Email, contraseña o código MFA incorrectos. Inténtalo de nuevo.")
            sys.exit(1)
        except GarminConnectTooManyRequestsError:
            print("Garmin ha bloqueado temporalmente los intentos de login (demasiados intentos). Espera un rato.")
            sys.exit(1)
        except GarminConnectConnectionError as e:
            print(f"No se pudo conectar con Garmin: {e}")
            sys.exit(1)

    if reused_session:
        print("Sesión reutilizada desde una conexión anterior (no hacía falta contraseña).")
    else:
        print(f"Sesión guardada en {TOKENSTORE}")

    # Llamada de prueba para confirmar que todo funciona de extremo a extremo
    try:
        name = garmin.get_full_name()
        activities = garmin.get_activities(0, 1)
        print(f"\nConectado como: {name}")
        if activities:
            a = activities[0]
            print(f"Última actividad: {a.get('activityName')} ({a.get('startTimeLocal')})")
        else:
            print("No se encontraron actividades recientes.")
        print("\n✓ Todo listo. Ya puedes usar scripts automáticos sin volver a pedir contraseña.")
    except Exception as e:
        print(f"Login correcto, pero la llamada de prueba falló: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
