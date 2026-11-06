$ErrorActionPreference = 'Stop'
$s3IdeExecutable = Join-Path $env:LOCALAPPDATA 'Programs\arduino-ide\Arduino IDE.exe'
$s3Sketch = Join-Path $PSScriptRoot 'CameraWebServerS3.ino'
Start-Process -FilePath $s3IdeExecutable -ArgumentList @("`"$s3Sketch`"")
