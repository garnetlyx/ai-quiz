# Run the API and the Expo web app on this machine's Tailscale address so any
# device on the tailnet can open http://<tailnet-ip>:<WEB_PORT>.
#
#   powershell -File scripts\tailnet.ps1 start|stop|restart|status
#
# Windows counterpart of scripts/tailnet.sh. Differences worth knowing:
#   - Spawns `npx tsx watch src/server.ts` directly instead of `npm run
#     dev:api`, because npm runs package scripts through cmd.exe on Windows and
#     the bash-style NODE_OPTIONS=... prefix in that script is not cmd syntax.
#   - Uses taskkill /T to take down the process tree (cmd -> npx -> node).
#
# Overrides: -ApiPort (3001), -WebPort (8081), -TailscaleBin, -RunDir.
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('start', 'stop', 'restart', 'status', '')]
  [string]$Action = 'status',

  [int]$ApiPort = 3001,
  [int]$WebPort = 8081,
  [string]$TailscaleBin = '',
  [string]$RunDir = ''
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
if (-not $RunDir) { $RunDir = Join-Path $env:TEMP 'ai-quiz-tailnet' }
if (-not $TailscaleBin) {
  $found = Get-Command tailscale -ErrorAction SilentlyContinue
  $TailscaleBin = if ($found) { $found.Source } else { 'C:\Program Files\Tailscale\tailscale.exe' }
}

function Get-TailnetIp {
  $ip = $null
  try {
    $ip = (& $TailscaleBin ip -4 2>$null) | Where-Object { $_ -match '\S' } | Select-Object -First 1
  } catch { }
  if (-not $ip) {
    Write-Error 'Tailscale has no IPv4 address; is it connected?'
  }
  return $ip
}

# Kill a process and everything it spawned (cmd -> npx -> tsx/expo -> node).
function Stop-Tree([int]$ProcessId) {
  if ($ProcessId -gt 0) {
    taskkill /PID $ProcessId /T /F 2>$null | Out-Null
  }
}

function Get-PortListeners([int]$Port) {
  try {
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
  } catch { }
}

function Stop-All {
  foreach ($name in @('api', 'web')) {
    $pidFile = Join-Path $RunDir "$name.pid"
    if (Test-Path $pidFile) {
      $procId = [int](Get-Content $pidFile -ErrorAction SilentlyContinue)
      Stop-Tree $procId
      Remove-Item $pidFile -ErrorAction SilentlyContinue
    }
  }
  # Anything still holding the ports (e.g. a server started by hand).
  foreach ($port in @($ApiPort, $WebPort)) {
    foreach ($procId in (Get-PortListeners $port)) {
      Stop-Tree ([int]$procId)
    }
  }
  Write-Host 'stopped'
}

# Any HTTP response (even 4xx/5xx) counts as up, mirroring `curl -s` in the
# bash version. TimeoutSec must outlast Metro's first bundle (triggered by this
# very request when --clear wiped the cache), otherwise every probe is cut off
# before the response arrives and the wait never succeeds.
function Wait-For([string]$Url, [int]$Tries = 30, [int]$TimeoutSec = 15) {
  for ($i = 0; $i -lt $Tries; $i++) {
    try {
      Invoke-WebRequest -UseBasicParsing -TimeoutSec $TimeoutSec -Uri $Url | Out-Null
      return $true
    } catch {
      if ($_.Exception.Response) { return $true }
    }
    Start-Sleep -Seconds 1
  }
  Write-Error "timed out waiting for $Url (see $RunDir\*.log)"
}

# Proxy-free port probe: proves the listener accepts connections even while
# Metro is still bundling.
function Wait-Tcp([string]$HostName, [int]$Port, [int]$Tries = 60) {
  for ($i = 0; $i -lt $Tries; $i++) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
      $task = $client.ConnectAsync($HostName, $Port)
      if ($task.Wait(2000) -and $client.Connected) { return $true }
    } catch { } finally { $client.Dispose() }
    Start-Sleep -Seconds 1
  }
  Write-Error "timed out waiting for ${HostName}:${Port} (see $RunDir\*.log)"
}

function Start-Child([string]$Command, [string]$WorkingDirectory, [string]$Name) {
  $out = Join-Path $RunDir "$Name.log"
  $err = Join-Path $RunDir "$Name.err.log"
  # Win32_Process.Create instead of Start-Process: the child is fully detached
  # (inherits neither console nor pipe handles), so this script's own stdout
  # closes when it exits even while the servers keep running. The catch: WMI
  # children do NOT inherit our environment, so env overrides are embedded in
  # the command line instead.
  $cmdLine = "$env:ComSpec /c `"$Command 1>>`"$out`" 2>>`"$err`"`""
  # SW_HIDE: without this WMI gives each cmd.exe a visible console window.
  # ([wmiclass] COM API, not New-CimInstance - the CIM instance form throws a
  # type mismatch on Windows PowerShell 5.1.)
  $startup = ([wmiclass]'Win32_ProcessStartup').CreateInstance()
  $startup.ShowWindow = 0
  $result = ([wmiclass]'Win32_Process').Create($cmdLine, $WorkingDirectory, $startup)
  if ($result.ReturnValue -ne 0) {
    Write-Error "failed to start ${Name}: Win32_Process.Create error $($result.ReturnValue)"
  }
  Set-Content -Path (Join-Path $RunDir "$Name.pid") -Value $result.ProcessId
}

function Start-All {
  $ip = Get-TailnetIp
  Stop-All | Out-Null
  New-Item -ItemType Directory -Force -Path $RunDir | Out-Null

  # API: bind to the tailnet IP only. (npx tsx directly instead of `npm run
  # dev:api` -- that npm script uses bash-only env prefix syntax.)
  Start-Child "set HOST=$ip&& set PORT=$ApiPort&& set NODE_OPTIONS=--dns-result-order=ipv4first&& npx tsx watch src/server.ts" (Join-Path $Root 'apps\api') 'api'

  # Web: Metro in serve mode, pointed at the tailnet API.
  Start-Child "set EXPO_PUBLIC_API_URL=http://$($ip):$ApiPort&& set CI=1&& npx expo start --web --port $WebPort --clear" (Join-Path $Root 'apps\web') 'web'

  Wait-Tcp $ip $ApiPort | Out-Null
  Wait-For "http://$($ip):$ApiPort/api/health" | Out-Null
  Wait-Tcp $ip $WebPort 120 | Out-Null
  Wait-For "http://$($ip):$WebPort/" 30 90 | Out-Null
  Write-Host "api  http://$($ip):$ApiPort"
  Write-Host "web  http://$($ip):$WebPort"
  Write-Host "logs $RunDir"
}

function Show-Status {
  $ip = Get-TailnetIp
  foreach ($pair in @(@('api', $ApiPort), @('web', $WebPort))) {
    $name = $pair[0]; $port = $pair[1]
    if (Get-PortListeners $port) {
      Write-Host "$name up   http://$($ip):$port"
    } else {
      Write-Host "$name down"
    }
  }
}

switch ($Action) {
  'start' { Start-All }
  'restart' { Start-All }
  'stop' { Stop-All }
  'status' { Show-Status }
  '' {
    Write-Host 'usage: powershell -File scripts\tailnet.ps1 start|stop|restart|status'
    exit 2
  }
}
