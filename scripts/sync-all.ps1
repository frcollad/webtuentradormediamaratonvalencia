# Sincroniza Strava + Garmin con el repo cada vez que se ejecuta: pull,
# descarga, commit y push. Pensado para correr cada 15 min desde el
# Programador de tareas de Windows mientras el PC este encendido - el
# workflow de GitHub Actions hace lo mismo en la nube como respaldo, pero
# con mucho mas retraso (GitHub no cumple el horario del cron con precision).
#
# Los secrets de Strava NO estan en este archivo (es publico en el repo).
# Se cargan desde un archivo fuera del repo, en tu perfil de usuario:
#   C:\Users\franc\.tuentrenador-secrets.ps1

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$secretsFile = Join-Path $HOME '.tuentrenador-secrets.ps1'
if (Test-Path $secretsFile) {
    . $secretsFile
} else {
    Write-Output "Aviso: no se encontro $secretsFile - la sincronizacion de Strava se saltara."
}

Start-Transcript -Path (Join-Path $PSScriptRoot 'sync-all.log') -Append | Out-Null
Write-Output "--- $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ---"

try {
    git pull --rebase origin main
    if ($LASTEXITCODE -ne 0) {
        Write-Output "git pull --rebase fallo (codigo $LASTEXITCODE). Abandonando."
        exit 1
    }

    if ($env:STRAVA_CLIENT_ID) {
        node scripts\update-strava.mjs
        if ($LASTEXITCODE -ne 0) { Write-Output "update-strava.mjs fallo (codigo $LASTEXITCODE)." }
    }

    python scripts\update-garmin.py
    if ($LASTEXITCODE -ne 0) { Write-Output "update-garmin.py fallo (codigo $LASTEXITCODE)." }

    git add data\strava.json data\garmin.json
    git diff --staged --quiet
    if ($LASTEXITCODE -ne 0) {
        git commit -m "chore: sync Strava + Garmin (local)"
        git push origin main
        if ($LASTEXITCODE -ne 0) {
            Write-Output "git push fallo (codigo $LASTEXITCODE)."
            exit 1
        }
        Write-Output "Datos actualizados y subidos."
    } else {
        Write-Output "Sin cambios."
    }
} finally {
    Stop-Transcript | Out-Null
}
