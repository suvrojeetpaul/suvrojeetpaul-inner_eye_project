param(
    [int]$Port = 8000,
    [switch]$NoKill,
    [switch]$Background
)

$ErrorActionPreference = "Stop"

$workspaceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendPath = Join-Path $workspaceRoot "backend/main.py"
$pythonExe = "C:/Users/Arjaa Chatterjee/.conda/envs/myenv/python.exe"

if (-not (Test-Path $backendPath)) {
    Write-Error "backend/main.py not found at $backendPath"
    exit 1
}

if (-not (Test-Path $pythonExe)) {
    Write-Warning "Configured Python interpreter not found at $pythonExe"
    $pythonExe = "python"
}

$listeners = netstat -ano |
    Select-String ":$Port" |
    Select-String "LISTENING"

$portPids = @()
foreach ($line in $listeners) {
    $parts = ($line.ToString() -split "\s+") | Where-Object { $_ -ne "" }
    if ($parts.Count -gt 0) {
        $pidText = $parts[$parts.Count - 1]
        if ($pidText -match "^\d+$") {
            $portPids += [int]$pidText
        }
    }
}
$portPids = $portPids | Sort-Object -Unique

if ($portPids.Count -gt 0) {
    Write-Host "Detected listeners on port ${Port}: $($portPids -join ', ')"
    if (-not $NoKill) {
        foreach ($portPid in $portPids) {
            Write-Host "Stopping PID $portPid"
            taskkill /PID $portPid /F | Out-Null
        }
        Start-Sleep -Seconds 1
    } else {
        Write-Error "Port $Port is busy and -NoKill was used"
        exit 1
    }
}

$stillBusy = netstat -ano |
    Select-String ":$Port" |
    Select-String "LISTENING"

if ($stillBusy) {
    Write-Error "Port $Port is still busy after cleanup"
    exit 1
}

Write-Host "Starting backend on 127.0.0.1:$Port"
if ($Background) {
    $startParams = @{
        FilePath = $pythonExe
        ArgumentList = @('"' + $backendPath + '"')
        WorkingDirectory = $workspaceRoot
        PassThru = $true
    }
    $proc = Start-Process @startParams

    $started = $false
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Milliseconds 500
        $listener = netstat -ano |
            Select-String ":$Port" |
            Select-String "LISTENING"
        if ($listener) {
            $started = $true
            break
        }
        if ($proc.HasExited) {
            break
        }
    }

    if ($started) {
        Write-Host "Backend started in background (PID $($proc.Id))"
    } else {
        if (-not $proc.HasExited) {
            Write-Warning "Backend process is alive (PID $($proc.Id)) but listener check did not complete in time."
            Write-Host "Check http://127.0.0.1:$Port/ after a few more seconds."
        } else {
            Write-Error "Background start failed: process exited before binding the port"
            exit 1
        }
    }
} else {
    & $pythonExe $backendPath
}
