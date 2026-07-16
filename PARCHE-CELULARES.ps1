# PARCHE: Orden de celulares por conexion (llamadas = cel1, WhatsApp = cel2)
# Ejecutar como Administrador en cada compu cliente.
# No requiere reinstalar la aplicacion.

$old = 'devices.sort((a, b) => a.serial.localeCompare(b.serial));'
$new = 'devices.sort((a, b) => 0); /*ADB: connection order ok*/'

if ($old.Length -ne $new.Length) {
    Write-Host "ERROR INTERNO: longitudes distintas ($($old.Length) vs $($new.Length))" -ForegroundColor Red
    exit 1
}

# Buscar app.asar en rutas tipicas de NSIS
$candidatos = @(
    "$env:LOCALAPPDATA\Programs\CRM Marketing Uphone\resources\app.asar",
    "$env:PROGRAMFILES\CRM Marketing Uphone\resources\app.asar",
    "C:\CRM Marketing Uphone\resources\app.asar"
)

$asarPath = $null
foreach ($c in $candidatos) {
    if (Test-Path $c) { $asarPath = $c; break }
}

if (-not $asarPath) {
    # Busqueda manual si no esta en rutas estandar
    Write-Host "Buscando app.asar... (puede tardar unos segundos)" -ForegroundColor Yellow
    $found = Get-ChildItem -Path "C:\", "$env:LOCALAPPDATA", "$env:PROGRAMFILES" `
        -Filter "app.asar" -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -like "*CRM*" } |
        Select-Object -First 1
    if ($found) { $asarPath = $found.FullName }
}

if (-not $asarPath) {
    Write-Host "No se encontro app.asar. Instale la aplicacion primero." -ForegroundColor Red
    exit 1
}

Write-Host "Encontrado: $asarPath" -ForegroundColor Cyan

# Leer bytes
$bytes = [System.IO.File]::ReadAllBytes($asarPath)
$oldBytes = [System.Text.Encoding]::UTF8.GetBytes($old)
$newBytes = [System.Text.Encoding]::UTF8.GetBytes($new)

# Buscar patron
$pos = -1
for ($i = 0; $i -le $bytes.Length - $oldBytes.Length; $i++) {
    $match = $true
    for ($j = 0; $j -lt $oldBytes.Length; $j++) {
        if ($bytes[$i + $j] -ne $oldBytes[$j]) { $match = $false; break }
    }
    if ($match) { $pos = $i; break }
}

if ($pos -eq -1) {
    Write-Host "Patron no encontrado. El parche ya fue aplicado o la version es diferente." -ForegroundColor Yellow
    exit 0
}

# Reemplazar in-place (mismo tamano)
for ($j = 0; $j -lt $newBytes.Length; $j++) {
    $bytes[$pos + $j] = $newBytes[$j]
}

# Backup + escribir
$backup = $asarPath + ".bak"
Copy-Item $asarPath $backup -Force
[System.IO.File]::WriteAllBytes($asarPath, $bytes)

Write-Host "Parche aplicado. Backup en: $backup" -ForegroundColor Green
Write-Host "Reinicie la aplicacion CRM Marketing Uphone." -ForegroundColor Green
