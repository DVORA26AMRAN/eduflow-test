$envMap = @{}

Get-Content .env | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') {
        return
    }

    $i = $_.IndexOf('=')

    if ($i -lt 1) {
        return
    }

    $k = $_.Substring(0, $i).Trim()
    $v = $_.Substring($i + 1).Trim().Trim('"').Trim("'")

    $envMap[$k] = $v
}

$url = $envMap['SUPABASE_URL']

if (-not $url) {
    $url = $envMap['VITE_SUPABASE_URL']
}

$serviceKey = $envMap['SUPABASE_SERVICE_ROLE_KEY']

if (-not $serviceKey) {
    $serviceKey = $envMap['SERVICE_ROLE_KEY']
}

Write-Output "URL_PRESENT=$([bool]$url)"
Write-Output "SERVICE_ROLE_PRESENT=$([bool]$serviceKey)"

if (-not $url -or -not $serviceKey) {
    Write-Output "MISSING_CREDENTIALS_FOR_INVOKE=1"
    exit 2
}

$body = '{"user_id":"7d158800-3f69-40e9-8343-0027fee11f4c"}'

$endpoint = "$url/functions/v1/meeting-meet-token-diagnostic"

$headers = @{
    Authorization  = "Bearer $serviceKey"
    apikey         = $serviceKey
    'Content-Type' = 'application/json'
}

try {
    $resp = Invoke-WebRequest `
        -Uri $endpoint `
        -Method POST `
        -Headers $headers `
        -Body $body `
        -UseBasicParsing

    $json = $resp.Content | ConvertFrom-Json

    Write-Output "HTTP_STATUS=$($resp.StatusCode)"
    Write-Output ("ok={0}" -f $json.ok)
    Write-Output ("branch={0}" -f $json.branch)
    Write-Output ("refresh_secret_found={0}" -f $json.refresh_secret_found)
    Write-Output ("encryption_key_id={0}" -f $json.encryption_key_id)
    Write-Output ("encryption_key_found_in_ring={0}" -f $json.encryption_key_found_in_ring)
    Write-Output ("active_key_id={0}" -f $json.active_key_id)
    Write-Output ("previous_key_id_present={0}" -f $json.previous_key_id_present)
    Write-Output ("decrypt_succeeded={0}" -f $json.decrypt_succeeded)
    Write-Output ("token_refresh_request_sent={0}" -f $json.token_refresh_request_sent)
    Write-Output ("token_refresh_http_status={0}" -f $json.token_refresh_http_status)
    Write-Output ("google_oauth_error_code={0}" -f $json.google_oauth_error_code)

    $desc = [string]$json.google_oauth_error_description

    if ($desc.Length -gt 200) {
        $desc = $desc.Substring(0, 200)
    }

    $desc = $desc -replace `
        '(?i)(ya29\.|1//|GOCSPX-|AIza)[A-Za-z0-9_\-.]+', `
        '[REDACTED]'

    Write-Output ("google_oauth_error_description={0}" -f $desc)
    Write-Output ("client_id_fingerprint={0}" -f $json.client_id_fingerprint)
    Write-Output ("calendar_request_reached={0}" -f $json.calendar_request_reached)
    Write-Output ("authorization_status_unchanged={0}" -f $json.authorization_status_unchanged)
    Write-Output ("error={0}" -f $json.error)
}
catch {
    $status = $null

    if ($_.Exception.Response) {
        $status = $_.Exception.Response.StatusCode.value__
    }

    Write-Output "HTTP_STATUS=$status"

    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader(
            $_.Exception.Response.GetResponseStream()
        )

        $errBody = $reader.ReadToEnd()

        try {
            $ej = $errBody | ConvertFrom-Json

            Write-Output ("error={0}" -f $ej.error)
            Write-Output ("branch={0}" -f $ej.branch)
            Write-Output ("ok={0}" -f $ej.ok)
        }
        catch {
            Write-Output "BODY_PARSE_FAILED=1"
            Write-Output ("BODY_LEN={0}" -f $errBody.Length)
        }
    }
}