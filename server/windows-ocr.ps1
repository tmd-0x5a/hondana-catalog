param(
  [Parameter(Mandatory = $true)]
  [string]$ImagePath
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
[void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
[void][Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]

function Wait-WinRtOperation {
  param(
    [Parameter(Mandatory = $true)]$Operation,
    [Parameter(Mandatory = $true)][Type]$ResultType
  )

  $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq "AsTask" -and
      $_.IsGenericMethod -and
      $_.GetParameters().Count -eq 1
    } |
    Select-Object -First 1
  $task = $asTaskMethod.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  $task.Wait()
  return $task.Result
}

$resolvedPath = (Resolve-Path -LiteralPath $ImagePath).Path
$file = Wait-WinRtOperation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($resolvedPath)) ([Windows.Storage.StorageFile])
$stream = Wait-WinRtOperation ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])

try {
  $decoder = Wait-WinRtOperation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Wait-WinRtOperation ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  try {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if ($null -eq $engine) {
      throw "Windows OCR language is not installed."
    }
    $result = Wait-WinRtOperation ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $lines = @($result.Lines | ForEach-Object { [string]$_.Text })
    [Console]::Out.Write((ConvertTo-Json -InputObject $lines -Compress))
  }
  finally {
    if ($null -ne $bitmap) { $bitmap.Dispose() }
  }
}
finally {
  $stream.Dispose()
}
