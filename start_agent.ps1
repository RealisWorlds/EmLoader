# Interactive Mindcraft Agent Launcher
param (
    [string]$ProfileName,
    [string]$HostMindserver
)

# Set the mindserver port from settings.js
# In a real implementation, you might want to parse this from the actual settings.js file
$mindserverPort = 8080

function Get-MindserverStatus {
    # Check if the mindserver port is in use
    try {
        $tcpClient = New-Object System.Net.Sockets.TcpClient
        $connectionResult = $tcpClient.BeginConnect("localhost", $mindserverPort, $null, $null)
        $connectionTimeout = $connectionResult.AsyncWaitHandle.WaitOne(100, $false)
        
        if ($connectionTimeout) {
            $tcpClient.EndConnect($connectionResult)
            return $true # Port is in use, mindserver is likely running
        }
        return $false # Port is not in use, mindserver is likely not running
    }
    catch {
        return $false # Error connecting, assume mindserver is not running
    }
    finally {
        if ($tcpClient -ne $null) {
            $tcpClient.Close()
        }
    }
}

function Get-ProfilesList {
    # Get a list of all profile files
    $profileFiles = Get-ChildItem -Path ".\profiles\" -Filter "*.json" | 
                    Where-Object { $_.Name -ne "defaults" } |
                    Select-Object -ExpandProperty Name
    
    # Remove .json extension
    return $profileFiles | ForEach-Object { $_ -replace '\.json$', '' }
}

# Main script

# If no profile name was provided, show an interactive menu
if (-not $ProfileName) {
    $profiles = Get-ProfilesList
    
    Write-Host "Available profiles:"
    for ($i = 0; $i -lt $profiles.Count; $i++) {
        Write-Host "[$($i+1)] $($profiles[$i])"
    }
    
    $selection = Read-Host "Select a profile number (1-$($profiles.Count))"
    $index = [int]$selection - 1
    
    if ($index -ge 0 -and $index -lt $profiles.Count) {
        $ProfileName = $profiles[$index]
    }
    else {
        Write-Host "Invalid selection. Exiting."
        exit 1
    }
}

# If host mindserver parameter wasn't provided, auto-detect
if (-not $HostMindserver) {
    $isMindserverRunning = Get-MindserverStatus
    
    if ($isMindserverRunning) {
        $HostMindserver = "false"
        Write-Host "Mindserver appears to be running already. This instance will not host the mindserver."
    }
    else {
        $HostMindserver = "true"
        Write-Host "No mindserver detected. This instance will host the mindserver."
    }
}

# Check if the profile exists
$profilePath = "./profiles/$ProfileName.json"
if (-not (Test-Path $profilePath)) {
    Write-Host "Error: Profile '$ProfileName' not found at path '$profilePath'"
    exit 1
}

# Start the agent
Write-Host "Starting Mindcraft with profile: $ProfileName"
Write-Host "Profile path: $profilePath"
Write-Host "Host mindserver: $HostMindserver"

node main.js --profiles $profilePath --host_mindserver $HostMindserver
