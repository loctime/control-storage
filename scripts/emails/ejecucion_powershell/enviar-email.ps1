# ==============================
# CONFIGURACION
# ==============================

$BACKEND_GET_URL  = "https://controlfile.onrender.com/api/email/get-pending-daily-alerts"
$BACKEND_SYNC_URL = "https://controlfile.onrender.com/api/email/sync-access-users"
$BACKEND_MARK_URL = "https://controlfile.onrender.com/api/email/mark-alert-sent"

$LOCAL_TOKEN = "61d4f092-2c7d-4fdf-8f83-624859888d77"

$SEND_FROM = "hys@maximia.com.ar"

# ==============================
# VARIABLES
# ==============================

$sentEmails = @()
$failedEmails = @()
$failedAlertIds = @()
$vehiclesWithoutOwner = @()
$totalPatentesEnviadas = 0
$startTime = Get-Date

$backendOk = $false
$syncOk = $false
$syncError = $null

try {

    Write-Host "Obteniendo alertas pendientes..."

    $response = Invoke-RestMethod `
        -Uri $BACKEND_GET_URL `
        -Method GET `
        -Headers @{ "x-local-token" = $LOCAL_TOKEN }

    if (-not $response.ok) {
        Write-Host "Respuesta inválida del backend."
        exit
    }

    $backendOk = $true

    $alerts  = $response.alerts
    $general = $response.general

    if (-not $alerts) { $alerts = @() }

    Write-Host "Grupos recibidos:" $alerts.Count

    # ==============================
    # OUTLOOK
    # ==============================

    $outlook   = New-Object -ComObject Outlook.Application
    $namespace = $outlook.GetNamespace("MAPI")
    $namespace.Logon()

    $storeToUse = $namespace.Stores | Where-Object { $_.DisplayName -eq $SEND_FROM }

    if (-not $storeToUse) {
        Write-Host "No se encontró el store para $SEND_FROM"
        exit
    }

    # ==============================
    # EMAIL GENERAL
    # ==============================

    if ($general -and $general.body) {

        $generalRecipients = @()
        if ($general.to) {
            $generalRecipients = if ($general.to -is [System.Array]) { $general.to } else { @($general.to) }
        }

        $generalCC = @()
        if ($general.cc) {
            $generalCC = if ($general.cc -is [System.Array]) { $general.cc } else { @($general.cc) }
        }

        if ($generalRecipients.Count -gt 0) {

            $generalMail = $storeToUse.GetDefaultFolder(6).Items.Add()

            $generalMail.To = ($generalRecipients -join ";")

            if ($generalCC.Count -gt 0) {
                $generalMail.CC = ($generalCC -join ";")
            }

            $generalMail.Subject  = $general.subject
            $generalMail.HTMLBody = $general.body

            $generalMail.Send()

            Write-Host "Email general enviado"
        }
    }

    # ==============================
    # ALERTAS POR RESPONSABLE
    # ==============================

    foreach ($alert in $alerts) {

        $recipients = @()

        if ($alert.responsableEmails) {
            $recipients = if ($alert.responsableEmails -is [System.Array]) {
                $alert.responsableEmails
            } else {
                @($alert.responsableEmails)
            }
        }

        $validRecipients = $recipients | Where-Object { $_ -match "@" }

        if (-not $validRecipients -or $validRecipients.Count -eq 0) {
            if ($alert.alertIds) {
                $vehiclesWithoutOwner += $alert.alertIds
            }
            continue
        }

        try {

            $mail = $storeToUse.GetDefaultFolder(6).Items.Add()
            $mail.To = ($validRecipients -join ";")

            if ($general -and $general.cc) {
                if ($general.cc -is [System.Array]) {
                    $mail.CC = ($general.cc -join ";")
                } else {
                    $mail.CC = $general.cc
                }
            }

            $mail.Subject  = $alert.subject
            $mail.HTMLBody = $alert.body
            $mail.Send()

            Start-Sleep -Milliseconds 200

            $sentEmails += $validRecipients
            $totalPatentesEnviadas += $alert.alertIds.Count

            $markBody = @{
                alertIds = $alert.alertIds
            } | ConvertTo-Json

            Invoke-RestMethod `
                -Uri $BACKEND_MARK_URL `
                -Method POST `
                -Headers @{ "x-local-token" = $LOCAL_TOKEN } `
                -Body $markBody `
                -ContentType "application/json"

        }
        catch {
            $failedEmails += $validRecipients
            if ($alert.alertIds) {
                $failedAlertIds += $alert.alertIds
            }
        }
    }

    # ==============================
    # SYNC ACCESS USERS
    # ==============================

    try {

        Write-Host "Sincronizando usuarios..."

        $syncResponse = Invoke-RestMethod `
            -Uri $BACKEND_SYNC_URL `
            -Method POST `
            -Headers @{ "x-local-token" = $LOCAL_TOKEN }

        if ($syncResponse.ok -eq $true) {
            $syncOk = $true
        }

    }
    catch {
        $syncError = $_.Exception.Message
    }

    # ==============================
    # REPORTE TECNICO
    # ==============================

    if ($general -and $general.reportRecipients) {

        $endTime = Get-Date
        $duration = ($endTime - $startTime).TotalSeconds
        $todayKey = $endTime.ToString("yyyy-MM-dd")

        $hostname = $env:COMPUTERNAME
        $username = $env:USERNAME

        # Global status metrics
        $alertsDetected = ($alerts | ForEach-Object {
            $ids = $_.alertIds
            if ($null -eq $ids) { 0 }
            elseif ($ids -is [System.Array]) { $ids.Count }
            else { 1 }
        } | Measure-Object -Sum).Sum
        $alertsSent = $totalPatentesEnviadas
        $alertsPending = [math]::Max(0, $alertsDetected - $alertsSent)
        $coveragePercent = if ($alertsDetected -gt 0) { [math]::Round($alertsSent / $alertsDetected * 100, 2) } else { 100 }

        $vehiclesWithoutOwnerCount = @($vehiclesWithoutOwner).Count
        $failedEmailsCount = if ($failedEmails) { $failedEmails.Count } else { 0 }

        $systemStatusOk = ($alertsPending -eq 0) -and ($failedEmailsCount -eq 0) -and ($vehiclesWithoutOwnerCount -eq 0) -and $backendOk
        $systemStatus = if ($systemStatusOk) { "OK" } else { "ERROR" }

        # Responsible validation
        $expectedRecipients = @($alerts | ForEach-Object {
            if ($_.responsableEmails) {
                $e = if ($_.responsableEmails -is [System.Array]) { $_.responsableEmails } else { @($_.responsableEmails) }
                $e | Where-Object { $_ -match "@" }
            }
        } | Sort-Object -Unique)
        $sentRecipients = @($sentEmails | ForEach-Object { $_ } | Sort-Object -Unique)
        $missingRecipients = @($expectedRecipients | Where-Object { $sentRecipients -notcontains $_ })
        $missingCount = @($missingRecipients).Count
        $expectedRecipientsCount = @($expectedRecipients).Count
        $sentRecipientsCount = @($sentRecipients).Count

        $uniqueFailed = @($failedEmails | ForEach-Object { $_ } | Sort-Object -Unique)

        $backendStatus = if ($backendOk) { "OK" } else { "ERROR" }
        $syncStatus = if ($syncOk) { "OK" } else { "ERROR" }
        if ($syncError) { $syncStatus += " - $syncError" }

        $largestGroup = 0
        foreach ($a in $alerts) {
            $c = if ($a.alertIds) { if ($a.alertIds -is [System.Array]) { $a.alertIds.Count } else { 1 } } else { 0 }
            if ($c -gt $largestGroup) { $largestGroup = $c }
        }
        $avgAlertTime = if ($alertsSent -gt 0) { [math]::Round($duration / $alertsSent, 2) } else { 0 }
        $totalErrors = $failedEmailsCount + $vehiclesWithoutOwnerCount

        $body = @"
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
body { font-family: Segoe UI, Arial, sans-serif; margin: 20px; color: #333; }
table { border-collapse: collapse; width: 100%; max-width: 600px; margin: 8px 0; }
th, td { border: 1px solid #bdc3c7; padding: 8px 12px; text-align: left; }
th { background: #2c3e50; color: white; }
tr:nth-child(even) { background: #ecf0f1; }
h2 { color: #1a5276; border-bottom: 2px solid #1a5276; padding-bottom: 4px; margin-top: 24px; }
h3 { color: #2874a6; margin-top: 16px; }
.status-ok { color: #27ae60; font-weight: bold; }
.status-error { color: #c0392b; font-weight: bold; }
.global-status { background: #ebf5fb; padding: 12px; border: 1px solid #3498db; margin: 12px 0; }
.dashboard { width: 100%; border-collapse: collapse; margin: 16px 0; }
.dashboard .card { width: 14%; vertical-align: top; padding: 12px; border: 1px solid #bdc3c7; background: #f8f9fa; text-align: center; }
.card-title { font-size: 11px; color: #5d6d7e; margin-bottom: 6px; font-weight: bold; }
.card-value { font-size: 18px; font-weight: bold; }
.card.ok .card-value { color: #27ae60; }
.card.error .card-value { color: #c0392b; }
.ok { color: #27ae60; }
.error { color: #c0392b; }
ul { margin: 4px 0; padding-left: 20px; }
</style>
</head>
<body>

<h2>Validaci&oacute;n de integridad - Sistema de alertas diarias</h2>
<p><strong>Fecha:</strong> $todayKey</p>

<table class="dashboard" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;">
<tr>
<td class="card $(if ($systemStatusOk) { 'ok' } else { 'error' })" style="width:14%; padding:12px; border:1px solid #bdc3c7; background:#f8f9fa; text-align:center; vertical-align:top;">
<div class="card-title">System Status</div>
<div class="card-value">$systemStatus</div>
</td>
<td class="card $(if ($coveragePercent -ge 100) { 'ok' } else { 'error' })" style="width:14%; padding:12px; border:1px solid #bdc3c7; background:#f8f9fa; text-align:center; vertical-align:top;">
<div class="card-title">Alert Coverage %</div>
<div class="card-value">$coveragePercent%</div>
</td>
<td class="card ok" style="width:14%; padding:12px; border:1px solid #bdc3c7; background:#f8f9fa; text-align:center; vertical-align:top;">
<div class="card-title">Alerts Sent</div>
<div class="card-value">$alertsSent</div>
</td>
<td class="card ok" style="width:14%; padding:12px; border:1px solid #bdc3c7; background:#f8f9fa; text-align:center; vertical-align:top;">
<div class="card-title">Recipients Notified</div>
<div class="card-value">$sentRecipientsCount</div>
</td>
<td class="card $(if ($totalErrors -eq 0) { 'ok' } else { 'error' })" style="width:14%; padding:12px; border:1px solid #bdc3c7; background:#f8f9fa; text-align:center; vertical-align:top;">
<div class="card-title">Errors</div>
<div class="card-value">$totalErrors</div>
</td>
<td class="card ok" style="width:14%; padding:12px; border:1px solid #bdc3c7; background:#f8f9fa; text-align:center; vertical-align:top;">
<div class="card-title">Largest Alert Group</div>
<div class="card-value">$largestGroup</div>
</td>
<td class="card ok" style="width:14%; padding:12px; border:1px solid #bdc3c7; background:#f8f9fa; text-align:center; vertical-align:top;">
<div class="card-title">Avg Time per Alert (s)</div>
<div class="card-value">$avgAlertTime</div>
</td>
</tr>
</table>

<h3>1. Global Status</h3>
<div class="global-status">
<p><strong>Status:</strong> <span class="status-$(if ($systemStatusOk) { 'ok' } else { 'error' })">$systemStatus</span></p>
<p><strong>Alert coverage:</strong> $coveragePercent%</p>
<table>
<tr><th>Concepto</th><th>Valor</th></tr>
<tr><td>Alerts detected</td><td>$alertsDetected</td></tr>
<tr><td>Alerts sent</td><td>$alertsSent</td></tr>
<tr><td>Alerts pending</td><td>$alertsPending</td></tr>
<tr><td>Vehicles without responsible</td><td>$vehiclesWithoutOwnerCount</td></tr>
<tr><td>Missing recipients</td><td>$missingCount</td></tr>
</table>
</div>

<h3>2. Alert Coverage</h3>
<table>
<tr><th>Concepto</th><th>Valor</th></tr>
<tr><td>Alerts detected</td><td>$alertsDetected</td></tr>
<tr><td>Alerts sent</td><td>$alertsSent</td></tr>
<tr><td>Alerts pending</td><td>$alertsPending</td></tr>
<tr><td>Coverage %</td><td>$coveragePercent%</td></tr>
</table>

<h3>3. Responsible Validation</h3>
<table>
<tr><th>Concepto</th><th>Valor</th></tr>
<tr><td>Expected recipients (unique)</td><td>$expectedRecipientsCount</td></tr>
<tr><td>Sent recipients (unique)</td><td>$sentRecipientsCount</td></tr>
<tr><td>Missing recipients</td><td>$missingCount</td></tr>
</table>
"@

        $body += "<h3>4. Vehicles Without Responsible</h3>`n"
        if ($vehiclesWithoutOwnerCount -gt 0) {
            $body += "<p>Alert IDs sin responsable asignado:</p><ul>`n"
            foreach ($id in $vehiclesWithoutOwner) {
                $body += "<li>$id</li>`n"
            }
            $body += "</ul>`n"
        } else {
            $body += "<p>None</p>`n"
        }

        $body += "<h3>5. Alerts Not Sent</h3>`n"
        if (@($failedAlertIds).Count -gt 0) {
            $body += "<p>Alert IDs no enviados:</p><ul>`n"
            foreach ($id in $failedAlertIds) {
                $body += "<li>$id</li>`n"
            }
            $body += "</ul>`n"
        } else {
            $body += "<p>None</p>`n"
        }

        $body += "<h3>6. Processed Groups Detail</h3>`n"
        $groupIndex = 0
        foreach ($alert in $alerts) {
            $rec = @()
            if ($alert.responsableEmails) {
                $rec = if ($alert.responsableEmails -is [System.Array]) { $alert.responsableEmails } else { @($alert.responsableEmails) }
            }
            $validRec = $rec | Where-Object { $_ -match "@" }
            if (-not $validRec -or $validRec.Count -eq 0) { continue }
            $groupIndex++
            $ids = $alert.alertIds
            $plateCount = if ($null -eq $ids) { 0 } elseif ($ids -is [System.Array]) { $ids.Count } else { 1 }
            $recList = ($validRec | ForEach-Object { [System.Net.WebUtility]::HtmlEncode($_) }) -join ", "
            $body += "<p><strong>Group $groupIndex</strong><br>Recipients: $recList<br>Plates notified: $plateCount</p>`n"
        }
        if ($groupIndex -eq 0) { $body += "<p>None</p>`n" }

        $body += "<h3>7. Recipient Summary</h3>`n<ul>`n"
        if (@($sentRecipients).Count -gt 0) {
            foreach ($r in $sentRecipients) {
                $enc = [System.Net.WebUtility]::HtmlEncode($r)
                $body += "<li>$enc</li>`n"
            }
        } else {
            $body += "<li>None</li>`n"
        }
        $body += "</ul>`n"

        $body += "<h3>8. Failed Emails</h3>`n"
        if (@($uniqueFailed).Count -gt 0) {
            $body += "<ul>`n"
            foreach ($f in $uniqueFailed) {
                $enc = [System.Net.WebUtility]::HtmlEncode($f)
                $body += "<li>$enc</li>`n"
            }
            $body += "</ul>`n"
        } else {
            $body += "<p>None</p>`n"
        }

        $body += @"
<h3>9. System Health</h3>
<table>
<tr><th>Componente</th><th>Estado</th></tr>
<tr><td>Backend API</td><td class="status-$(if ($backendOk) { 'ok' } else { 'error' })">$backendStatus</td></tr>
<tr><td>Sync Access Users</td><td class="status-$(if ($syncOk) { 'ok' } else { 'error' })">$syncStatus</td></tr>
</table>

<h3>10. Execution Data</h3>
<table>
<tr><th>Concepto</th><th>Valor</th></tr>
<tr><td>Inicio ejecuci&oacute;n</td><td>$($startTime.ToString("yyyy-MM-dd HH:mm:ss"))</td></tr>
<tr><td>Fin ejecuci&oacute;n</td><td>$($endTime.ToString("yyyy-MM-dd HH:mm:ss"))</td></tr>
<tr><td>Duraci&oacute;n (seg)</td><td>$([math]::Round($duration, 2))</td></tr>
<tr><td>Host (COMPUTERNAME)</td><td>$hostname</td></tr>
<tr><td>Usuario (USERNAME)</td><td>$username</td></tr>
</table>

</body>
</html>
"@

        $reportRecipients = if ($general.reportRecipients -is [System.Array]) {
            $general.reportRecipients
        } else {
            @($general.reportRecipients)
        }

        if ($reportRecipients.Count -gt 0) {

            $reportMail = $storeToUse.GetDefaultFolder(6).Items.Add()

            $reportMail.To = ($reportRecipients -join ";")
            $reportMail.Subject = "[ALERTAS] $systemStatus - $alertsSent alertas enviadas - $todayKey"
            $reportMail.HTMLBody = $body

            $reportMail.Send()

            Write-Host "Reporte tecnico enviado"
        }
    }

    Write-Host "Proceso finalizado."
}
catch {

    Write-Host "Error general:"
    Write-Host $_
}