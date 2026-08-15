Add-Type -AssemblyName System.Drawing

function New-IconBitmap([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::FromArgb(255, 11, 11, 14))
    $pad = [Math]::Max(2, [int]($size * 0.08))
    $rect = New-Object System.Drawing.Rectangle $pad, $pad, ($size - 2 * $pad), ($size - 2 * $pad)
    $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 11, 11, 14))
    $red = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 229, 9, 20))
    $g.FillRectangle($bg, 0, 0, $size, $size)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $cx = $size * 0.42
    $top = $size * 0.22
    $bot = $size * 0.78
    $right = $size * 0.78
    $path.AddPolygon(@(
        (New-Object System.Drawing.PointF $cx, $top),
        (New-Object System.Drawing.PointF $right, ($size / 2.0)),
        (New-Object System.Drawing.PointF $cx, $bot)
    ))
    $g.FillPath($red, $path)
    $g.Dispose()
    return $bmp
}

$iconDir = Join-Path $PSScriptRoot "..\src-tauri\icons"
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null

$map = [ordered]@{
    "32x32.png" = 32
    "128x128.png" = 128
    "128x128@2x.png" = 256
    "icon.png" = 512
    "Square30x30Logo.png" = 30
    "Square44x44Logo.png" = 44
    "Square71x71Logo.png" = 71
    "Square89x89Logo.png" = 89
    "Square107x107Logo.png" = 107
    "Square142x142Logo.png" = 142
    "Square150x150Logo.png" = 150
    "Square284x284Logo.png" = 284
    "Square310x310Logo.png" = 310
    "StoreLogo.png" = 50
}

foreach ($name in $map.Keys) {
    $bmp = New-IconBitmap ([int]$map[$name])
    $bmp.Save((Join-Path $iconDir $name), [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

$icoBmp = New-IconBitmap 256
$icoPath = Join-Path $iconDir "icon.ico"
$ms = New-Object System.IO.MemoryStream
$icoBmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$png = $ms.ToArray()
$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter $fs
$bw.Write([int16]0)
$bw.Write([int16]1)
$bw.Write([int16]1)
$bw.Write([byte]0)
$bw.Write([byte]0)
$bw.Write([int16]1)
$bw.Write([int16]32)
$bw.Write([int32]$png.Length)
$bw.Write([int32]22)
$bw.Write($png)
$bw.Flush()
$fs.Close()
$icoBmp.Dispose()
Copy-Item (Join-Path $iconDir "icon.png") (Join-Path $iconDir "icon.icns") -Force
Write-Host "Icons written to $iconDir"
