param([switch]$SkipNpm, [switch]$SkipMemoryDefaults, [string]$PythonExe)
$ErrorActionPreference = 'Stop'
$env:PYTHONUTF8 = '1'
$coreRoot = Split-Path -Parent $PSScriptRoot
$memoryRoot = Join-Path (Split-Path -Parent $coreRoot) 'hy-memory-starter'
if (-not (Test-Path -LiteralPath (Join-Path $memoryRoot 'app.py'))) {
    throw 'Keep laurentina-core and hy-memory-starter next to each other. Extract the complete source archive.'
}
if (-not $IsWindows -and $PSVersionTable.PSEdition -eq 'Core') {
    throw 'This desktop release currently supports Windows 10/11 x64.'
}
$projectPython = Join-Path $memoryRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $projectPython)) {
    $pythonLauncher = Get-Command py -ErrorAction SilentlyContinue
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($PythonExe) {
        if (-not (Test-Path -LiteralPath $PythonExe -PathType Leaf)) { throw 'The supplied -PythonExe does not exist.' }
        & $PythonExe -E -s -c 'import sys; assert sys.version_info[:2] == (3, 12)'
        if ($LASTEXITCODE -ne 0) { throw '-PythonExe must be Python 3.12 x64.' }
        & $PythonExe -E -s -m venv (Join-Path $memoryRoot '.venv')
    } elseif ($pythonLauncher) {
        & $pythonLauncher.Source -3.12 -m venv (Join-Path $memoryRoot '.venv')
    } elseif ($pythonCommand) {
        & $pythonCommand.Source -c 'import sys; assert sys.version_info[:2] == (3, 12), "Install Python 3.12 x64"'
        if ($LASTEXITCODE -ne 0) { throw 'Install Python 3.12 x64 from python.org, with the Python launcher.' }
        & $pythonCommand.Source -m venv (Join-Path $memoryRoot '.venv')
    } else {
        throw 'Install Python 3.12 x64 from python.org, with the Python launcher, then rerun Setup.cmd.'
    }
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the project Python environment.' }
}
& $projectPython -E -s -c 'import sys; assert sys.version_info[:2] == (3, 12), "This release needs a Python 3.12 environment"'
if ($LASTEXITCODE -ne 0) { throw 'Existing project environment is not Python 3.12. Keep a backup and recreate .venv with Python 3.12.' }
& $projectPython -E -s -m pip install --disable-pip-version-check -c (Join-Path $memoryRoot 'requirements.lock.txt') -r (Join-Path $memoryRoot 'requirements.txt') -r (Join-Path $coreRoot 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Installing Python dependencies failed.' }
& $projectPython -E -s -m pip check
if ($LASTEXITCODE -ne 0) { throw 'Python dependency verification failed.' }
if (-not $SkipNpm) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $nodeCommand -or -not $npmCommand) { throw 'Install Node.js 22 LTS (including npm), then rerun Setup.cmd.' }
    $nodeVersion = & $nodeCommand.Source --version
    if ($LASTEXITCODE -ne 0 -or [int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 22) { throw 'Node.js 22 or newer is required for this setup.' }
    Push-Location $coreRoot
    try {
        if (Test-Path -LiteralPath 'package-lock.json') {
            & $npmCommand.Source ci --include=dev --no-audit --no-fund
        } else {
            & $npmCommand.Source install --include=dev --no-audit --no-fund
        }
        if ($LASTEXITCODE -ne 0) { throw 'Installing the project-local Electron runtime failed.' }
        # New npm versions may leave dependency lifecycle scripts disabled.
        # Run only the pinned Electron install entry, without enabling all scripts.
        if (-not (Test-Path -LiteralPath 'node_modules\electron\dist\electron.exe')) {
            $electronInstaller = Join-Path $coreRoot 'node_modules\electron\install.js'
            if (-not (Test-Path -LiteralPath $electronInstaller -PathType Leaf)) { throw 'The locked Electron package is missing its installer.' }
            & $nodeCommand.Source $electronInstaller
            if ($LASTEXITCODE -ne 0) { throw 'Downloading the locked Electron binary failed.' }
        }
        if (-not (Test-Path -LiteralPath 'node_modules\electron\dist\electron.exe')) { throw 'Electron download is incomplete. Retry npm install.' }
    } finally { Pop-Location }
}
if (-not $SkipMemoryDefaults) {
    & $projectPython -E -s -X utf8 (Join-Path $PSScriptRoot 'configure_local_memory.py') --initialize
    if ($LASTEXITCODE -ne 0) { throw 'Creating local memory defaults failed.' }
}
Write-Host 'Core ready. Install Ollama and pull your chat/embedding models before using local chat and memory.'
Write-Host 'Voice, Live2D/Spine runtimes, and Hermes are optional: see docs/SETUP.md.'
