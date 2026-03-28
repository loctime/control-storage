# ==============================
# CONFIGURACION
# ==============================

$BACKEND_URL = "https://controlfile.onrender.com/api/email-local-ingest"
$LOCAL_TOKEN = "61d4f092-2c7d-4fdf-8f83-624859888d77"
$SOURCE = "outlook-local"

$TARGET_SENDERS = @(
    "noresponder@avisos.rsvonline.com.ar",
    "fer@gmail.com",
    "miguel@gmail.com"
)

# ==============================
# OUTLOOK INGEST MULTI-CUENTA
# ==============================

try {

    $outlook = New-Object -ComObject Outlook.Application
    $namespace = $outlook.GetNamespace("MAPI")

    foreach ($store in $namespace.Stores) {

        Write-Host "==============================="
        Write-Host "Procesando cuenta:" $store.DisplayName
        Write-Host "==============================="

        $root = $store.GetRootFolder()
        $inbox = $root.Folders | Where-Object { $_.Name -eq "Bandeja de entrada" }

        if ($inbox -eq $null) {
            Write-Host "No se encontró bandeja de entrada en esta cuenta"
            continue
        }

        $items = $inbox.Items
        $items.Sort("[ReceivedTime]", $true)

        foreach ($mail in $items) {

            # Solo correos reales
            if ($mail.Class -ne 43) { continue }

            # Solo NO leídos
            if (-not $mail.UnRead) { continue }

            $sender = $mail.SenderEmailAddress

            # Filtrar remitentes
            if (-not ($TARGET_SENDERS -contains $sender)) { continue }

            Write-Host "Procesando:" $store.DisplayName "-" $sender "-" $mail.Subject

            $email = @{
                message_id  = $mail.EntryID
                from        = $sender
                to          = @($mail.To)
                subject     = $mail.Subject
                body_text   = $mail.Body
                body_html   = $mail.HTMLBody
                received_at = $mail.ReceivedTime.ToString("o")
                attachments = @()
            }

            foreach ($att in $mail.Attachments) {
                $email.attachments += @{
                    filename = $att.FileName
                    size     = $att.Size
                }
            }

            $payload = @{
                source = $SOURCE
                email  = $email
            } | ConvertTo-Json -Depth 10

            try {

                $response = Invoke-RestMethod `
                    -Uri $BACKEND_URL `
                    -Method POST `
                    -Headers @{ "x-local-token" = $LOCAL_TOKEN } `
                    -Body $payload `
                    -ContentType "application/json"

                if ($response.ok -eq $true) {
                    $mail.UnRead = $false
                    Write-Host "OK - Marcado como leído"
                }
                else {
                    Write-Host "Backend respondió pero no confirmó OK"
                }

            } catch {
                Write-Host "Error enviando:"
                Write-Host $_
            }
        }
    }

    Write-Host "======================================"
    Write-Host "Proceso finalizado en todas las cuentas"
    Write-Host "======================================"

} catch {
    Write-Error "Error general ejecutando script"
    Write-Error $_
}
