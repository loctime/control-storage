# ==============================
# CONFIG (portable)
# ==============================

# Carpeta del ejecutable
$BASE_PATH = Split-Path -Parent ([Environment]::GetCommandLineArgs()[0])

# Log
$LOG_FILE  = Join-Path $BASE_PATH "procesar-alertas.log"

function Write-Log {
    param($msg)

    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "$timestamp - $msg"

    $line | Out-File -FilePath $LOG_FILE -Append
    Write-Host $line
}

try {

    Write-Log "---- INICIO PROCESO ----"
    Write-Log "BASE_PATH: $BASE_PATH"

    Write-Log "Ejecutando obtener-email.ps1"
    & (Join-Path $BASE_PATH "obtener-email.ps1")

    if (-not $?) { throw "Falló obtener-email.ps1" }

    Write-Log "Esperando 60 segundos..."
    Start-Sleep -Seconds 60

    Write-Log "Ejecutando enviar-email.ps1"
    & (Join-Path $BASE_PATH "enviar-email.ps1")

    if (-not $?) { throw "Falló enviar-email.ps1" }

    Write-Log "Proceso finalizado correctamente"
}
catch {

    $errorMsg = "ERROR: $($_.Exception.Message)"

    Write-Log $errorMsg
    Write-Host $errorMsg -ForegroundColor Red
}

Write-Host ""
Write-Host "Proceso terminado."
Write-Host "Presiona ENTER para cerrar..."
Read-Host