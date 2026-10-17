param(
    [string]$RawImagePath = "",
    [string]$SourcePath = (Join-Path $PSScriptRoot "..\build\icon.png")
)

Add-Type -AssemblyName System.Drawing

$root = Resolve-Path (Join-Path $PSScriptRoot "..")

function New-RoundedIconBitmap([System.Drawing.Bitmap]$raw, [int]$canvasSize = 1024) {
    $dest = New-Object System.Drawing.Bitmap($canvasSize, $canvasSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($dest)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $pad = [int]([Math]::Round($canvasSize * 0.04))
    $rectSize = $canvasSize - ($pad * 2)
    $radius = [int]([Math]::Round($rectSize * 0.225))
    $diameter = $radius * 2

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($pad, $pad, $diameter, $diameter, 180, 90)
    $path.AddArc($pad + $rectSize - $diameter, $pad, $diameter, $diameter, 270, 90)
    $path.AddArc($pad + $rectSize - $diameter, $pad + $rectSize - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($pad, $pad + $rectSize - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()

    $g.SetClip($path)
    $g.DrawImage($raw, $pad, $pad, $rectSize, $rectSize)
    $g.ResetClip()

    $penWidth = [Math]::Max(2.0, [float]($canvasSize * 0.004))
    $borderColor = [System.Drawing.Color]::FromArgb(70, 160, 230, 235)
    $pen = New-Object System.Drawing.Pen($borderColor, $penWidth)
    $g.DrawPath($pen, $path)

    $pen.Dispose()
    $path.Dispose()
    $g.Dispose()
    return $dest
}

if ($RawImagePath -ne "" -and (Test-Path $RawImagePath)) {
    $rawBytes = [System.IO.File]::ReadAllBytes((Resolve-Path $RawImagePath))
    $rawMs = New-Object System.IO.MemoryStream(,$rawBytes)
    $rawBmp = [System.Drawing.Bitmap]::FromStream($rawMs)
    $masterBmp = New-RoundedIconBitmap -raw $rawBmp -canvasSize 1024
    $rawBmp.Dispose()
    $rawMs.Dispose()

    $outMs = New-Object System.IO.MemoryStream
    $masterBmp.Save($outMs, [System.Drawing.Imaging.ImageFormat]::Png)
    [System.IO.File]::WriteAllBytes((Join-Path $root "build\icon.png"), $outMs.ToArray())
    $outMs.Dispose()
    $masterBmp.Dispose()
}

if (-not (Test-Path $SourcePath)) {
    Write-Error "Source image not found: $SourcePath"
    exit 1
}

$srcBytes = [System.IO.File]::ReadAllBytes((Resolve-Path $SourcePath))
$srcMs = New-Object System.IO.MemoryStream(,$srcBytes)
$src = [System.Drawing.Bitmap]::FromStream($srcMs)

function New-ResizedPngBytes([System.Drawing.Bitmap]$bitmap, [int]$size) {
    $dest = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($dest)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($bitmap, 0, 0, $size, $size)
    $g.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $dest.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $dest.Dispose()
    $bytes = $ms.ToArray()
    $ms.Dispose()
    return ,$bytes
}

$allSizes = @(16, 24, 32, 48, 64, 128, 180, 192, 256, 512)
$pngMap = @{}
foreach ($s in $allSizes) {
    $pngMap[$s] = New-ResizedPngBytes -bitmap $src -size $s
}

$src.Dispose()
$srcMs.Dispose()

# 1. Build ICO with [16, 24, 32, 48, 64, 128, 256]
$icoSizes = @(16, 24, 32, 48, 64, 128, 256)
$icoMs = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($icoMs)

$writer.Write([UInt16]0) # Reserved
$writer.Write([UInt16]1) # Type (1 = Icon)
$writer.Write([UInt16]$icoSizes.Count)

$offset = 6 + (16 * $icoSizes.Count)
foreach ($s in $icoSizes) {
    $data = $pngMap[$s]
    $w = if ($s -ge 256) { [byte]0 } else { [byte]$s }
    $h = if ($s -ge 256) { [byte]0 } else { [byte]$s }
    $writer.Write($w)
    $writer.Write($h)
    $writer.Write([byte]0)
    $writer.Write([byte]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]32)
    $writer.Write([UInt32]$data.Length)
    $writer.Write([UInt32]$offset)
    $offset += $data.Length
}
foreach ($s in $icoSizes) {
    $writer.Write($pngMap[$s])
}
$writer.Flush()
$icoBytes = $icoMs.ToArray()
$writer.Close()
$icoMs.Dispose()

[System.IO.File]::WriteAllBytes((Join-Path $root "build\icon.ico"), $icoBytes)
[System.IO.File]::WriteAllBytes((Join-Path $root "public\icon.ico"), $icoBytes)
if (Test-Path (Join-Path $root "dist")) {
    [System.IO.File]::WriteAllBytes((Join-Path $root "dist\icon.ico"), $icoBytes)
}

# 2. Linux icon set: build/icons/{16,24,32,48,64,128,256,512}x{s}.png
$linuxIconsDir = Join-Path $root "build\icons"
if (-not (Test-Path $linuxIconsDir)) { New-Item -ItemType Directory -Path $linuxIconsDir | Out-Null }
foreach ($s in @(16, 24, 32, 48, 64, 128, 256, 512)) {
    [System.IO.File]::WriteAllBytes((Join-Path $linuxIconsDir "${s}x${s}.png"), $pngMap[$s])
}

# 3. Web public icons (including icon-32, icon-64 used by TitleBar.tsx, icon-180, icon-192, icon-512)
$publicIconsDir = Join-Path $root "public\icons"
if (-not (Test-Path $publicIconsDir)) { New-Item -ItemType Directory -Path $publicIconsDir | Out-Null }
[System.IO.File]::WriteAllBytes((Join-Path $root "public\icon.png"), $pngMap[256])
foreach ($s in @(32, 64, 180, 192, 512)) {
    [System.IO.File]::WriteAllBytes((Join-Path $publicIconsDir "icon-${s}.png"), $pngMap[$s])
}
if (Test-Path (Join-Path $root "dist")) {
    [System.IO.File]::WriteAllBytes((Join-Path $root "dist\icon.png"), $pngMap[256])
    $distIconsDir = Join-Path $root "dist\icons"
    if (-not (Test-Path $distIconsDir)) { New-Item -ItemType Directory -Path $distIconsDir | Out-Null }
    foreach ($s in @(32, 64, 180, 192, 512)) {
        [System.IO.File]::WriteAllBytes((Join-Path $distIconsDir "icon-${s}.png"), $pngMap[$s])
    }
}

# 4. macOS ICNS (build/icon.icns)
function ConvertTo-BigEndianUInt32([uint32]$val) {
    $b = [BitConverter]::GetBytes($val)
    [Array]::Reverse($b)
    return ,$b
}

$icnsChunks = @(
    @{ Type = "icp4"; Data = $pngMap[16] },
    @{ Type = "icp5"; Data = $pngMap[32] },
    @{ Type = "icp6"; Data = $pngMap[64] },
    @{ Type = "ic07"; Data = $pngMap[128] },
    @{ Type = "ic08"; Data = $pngMap[256] },
    @{ Type = "ic09"; Data = $pngMap[512] }
)

$totalLen = 8
foreach ($c in $icnsChunks) { $totalLen += (8 + $c.Data.Length) }

$icnsMs = New-Object System.IO.MemoryStream
$icnsWriter = New-Object System.IO.BinaryWriter($icnsMs)
$icnsWriter.Write([System.Text.Encoding]::ASCII.GetBytes("icns"))
$icnsWriter.Write((ConvertTo-BigEndianUInt32 ([uint32]$totalLen)))
foreach ($c in $icnsChunks) {
    $icnsWriter.Write([System.Text.Encoding]::ASCII.GetBytes($c.Type))
    $icnsWriter.Write((ConvertTo-BigEndianUInt32 ([uint32](8 + $c.Data.Length))))
    $icnsWriter.Write($c.Data)
}
$icnsWriter.Flush()
[System.IO.File]::WriteAllBytes((Join-Path $root "build\icon.icns"), $icnsMs.ToArray())
$icnsWriter.Close()
$icnsMs.Dispose()

Write-Host "All icons (Windows .ico, macOS .icns, Linux PNGs, Web manifest PNGs) generated successfully!"