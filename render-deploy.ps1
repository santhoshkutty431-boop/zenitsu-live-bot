$token = $env:RENDER_API_TOKEN
if (-not $token) {
    Write-Host "ERROR: RENDER_API_TOKEN is required."
    exit 1
}
$headers = @{
    "Authorization" = "Bearer $token"
    "Accept"        = "application/json"
    "Content-Type"  = "application/json"
}

$body = @{
    type    = "web_service"
    name    = "zenitsu-live-bot"
    ownerId = "tea-d920jfnaqgkc73ed3de0"
    repo    = "https://github.com/santhoshkutty431-boop/zenitsu-live-bot"
    branch  = "main"
    autoDeploy = "yes"
    serviceDetails = @{
        runtime      = "node"
        plan         = "free"
        region       = "singapore"
        numInstances = 1
        pullRequestPreviewsEnabled = "no"
        healthCheckPath = "/"
        envSpecificDetails = @{
            buildCommand = "npm install --omit=dev"
            startCommand = "node index.js"
        }
    }
    envVars = @(
        @{ key = "DISCORD_TOKEN";      value = $env:DISCORD_TOKEN },
        @{ key = "CLIENT_ID";          value = "1488445899448385627" },
        @{ key = "GUILD_ID";           value = "1444533392518680719" },
        @{ key = "CATEGORY_TICKETS";   value = "1521562030040027366" },
        @{ key = "CHANNEL_WELCOME";    value = "1521562002810736831" },
        @{ key = "CHANNEL_REPORTS";    value = "1521562028114710598" },
        @{ key = "CHANNEL_FEEDBACK";   value = "1521562022477566174" },
        @{ key = "CHANNEL_PANEL";      value = "1521562007646503172" },
        @{ key = "CHANNEL_SONG_REQUEST"; value = "1521562012935520348" },
        @{ key = "SERVER_LOGS_ID";     value = "1521577044687847464" },
        @{ key = "VOICE_LOG_ID";       value = "1521577051516047573" },
        @{ key = "MOD_LOG_ID";         value = "1521577060689248519" },
        @{ key = "PORT";               value = "8080" },
        @{ key = "DASHBOARD_PASSCODE"; value = $env:DASHBOARD_PASSCODE },
        @{ key = "DASHBOARD_COOKIE_SECRET"; value = $env:DASHBOARD_COOKIE_SECRET }
    )
} | ConvertTo-Json -Depth 10

Write-Host "Creating Render service..."
try {
    $response = Invoke-RestMethod -Uri "https://api.render.com/v1/services" -Method Post -Headers $headers -Body $body
    Write-Host "SUCCESS!"
    Write-Host "Service ID   : $($response.service.id)"
    Write-Host "Service Name : $($response.service.name)"
    Write-Host "Dashboard URL: https://dashboard.render.com/web/$($response.service.id)"
    Write-Host "Service URL  : $($response.service.serviceDetails.url)"
    Write-Host "Status       : $($response.deployId)"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $reader.BaseStream.Position = 0
    $responseBody = $reader.ReadToEnd()
    Write-Host "Response: $responseBody"
}
