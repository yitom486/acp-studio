Add-Type -AssemblyName System.Drawing

$srcPath = Join-Path $PSScriptRoot "..\public\acp-studio-cat.png"
if (-not (Test-Path $srcPath)) {
    Write-Error "Source image not found: $srcPath"
    exit 1
}

$src = [System.Drawing.Bitmap]::FromFile($srcPath)
$sizes = @(256, 128, 64, 48, 32, 16)
$pngBuffers = @()

foreach ($s in $sizes) {
    $dest = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($dest)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($src, 0, 0, $s, $s)
    $g.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $dest.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $dest.Dispose()

    $bytes = $ms.ToArray()
    $ms.Dispose()

    $pngBuffers += [PSCustomObject]@{
        Size = $s
        Data = $bytes
    }
}
$src.Dispose()

# Create ICO file with all resolution frames
$icoMs = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($icoMs)

# 1. ICONDIR Header (6 bytes)
$writer.Write([UInt16]0) # Reserved
$writer.Write([UInt16]1) # Type (1 = Icon)
$writer.Write([UInt16]$sizes.Count) # Image count

# Calculate initial offset for image data: 6 + (16 * count)
$offset = 6 + (16 * $sizes.Count)

# 2. ICONDIRENTRY entries (16 bytes each)
foreach ($item in $pngBuffers) {
    $s = $item.Size
    $w = if ($s -ge 256) { [byte]0 } else { [byte]$s }
    $h = if ($s -ge 256) { [byte]0 } else { [byte]$s }
    $writer.Write($w) # Width
    $writer.Write($h) # Height
    $writer.Write([byte]0) # ColorCount
    $writer.Write([byte]0) # Reserved
    $writer.Write([UInt16]1) # Planes
    $writer.Write([UInt16]32) # BitCount
    $writer.Write([UInt32]$item.Data.Length) # Image size
    $writer.Write([UInt32]$offset) # Image offset

    $offset += $item.Data.Length
}

# 3. Image payloads
foreach ($item in $pngBuffers) {
    $writer.Write($item.Data)
}

$writer.Flush()

# Save to public/icon.ico and dist/icon.ico
$publicIco = Join-Path $PSScriptRoot "..\public\icon.ico"
$distIco = Join-Path $PSScriptRoot "..\dist\icon.ico"

[System.IO.File]::WriteAllBytes($publicIco, $icoMs.ToArray())
if (Test-Path (Join-Path $PSScriptRoot "..\dist")) {
    [System.IO.File]::WriteAllBytes($distIco, $icoMs.ToArray())
}

# Also save 256x256 PNG as standard app icon
$publicPng256 = Join-Path $PSScriptRoot "..\public\icon.png"
$distPng256 = Join-Path $PSScriptRoot "..\dist\icon.png"
[System.IO.File]::WriteAllBytes($publicPng256, $pngBuffers[0].Data)
if (Test-Path (Join-Path $PSScriptRoot "..\dist")) {
    [System.IO.File]::WriteAllBytes($distPng256, $pngBuffers[0].Data)
}

$writer.Close()
$icoMs.Dispose()

Write-Host "Icons generated successfully!"
Write-Host "ICO Size: $((Get-Item $publicIco).Length) bytes"
