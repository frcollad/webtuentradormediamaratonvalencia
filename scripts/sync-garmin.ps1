# Sincroniza los datos de bienestar de Garmin con el repo: pull, descarga,
# commit y push, sin intervención. Pensado para una tarea programada diaria.
# Requiere que ya exista una sesión guardada (ver scripts/garmin_login.py).

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

Start-Transcript -Path (Join-Path $PSScriptRoot 'sync-garmin.log') -Append | Out-Null
Write-Output "--- $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ---"

try {
    git pull --rebase origin main
    if ($LASTEXITCODE -ne 0) {
        Write-Output "git pull --rebase falló (código $LASTEXITCODE). Abandonando."
        exit 1
    }

    python scripts\update-garmin.py
    if ($LASTEXITCODE -ne 0) {
        Write-Output "update-garmin.py falló (código $LASTEXITCODE). Abandonando."
        exit 1
    }

    git add data\garmin.json
    git diff --staged --quiet
    if ($LASTEXITCODE -ne 0) {
        git commit -m "chore: sync Garmin wellness data"
        git push origin main
        if ($LASTEXITCODE -ne 0) {
            Write-Output "git push falló (código $LASTEXITCODE)."
            exit 1
        }
        Write-Output "Datos de Garmin actualizados y subidos."
    } else {
        Write-Output "Sin cambios en los datos de Garmin."
    }
} finally {
    Stop-Transcript | Out-Null
}
