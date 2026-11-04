@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Exportar planos a PDF y PNG con Inkscape

set "INK=C:\Program Files\Inkscape\bin\inkscape.exe"
set "AQUI=%~dp0"
set "SAL=%AQUI%salidas"

if not exist "%INK%" (
  echo [ERROR] No se encontro Inkscape en:
  echo         %INK%
  echo Instalalo desde https://inkscape.org/ y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)

if not exist "%SAL%" mkdir "%SAL%"

set /a N=0
for %%f in ("%AQUI%*.svg") do (
  echo.
  echo Convirtiendo %%~nxf ...
  "%INK%" --export-type=pdf --export-filename="%SAL%\%%~nf.pdf" "%%~ff"  >nul 2>&1
  "%INK%" --export-type=png --export-dpi=300 --export-filename="%SAL%\%%~nf.png" "%%~ff" >nul 2>&1
  if exist "%SAL%\%%~nf.pdf" (
     echo    OK: %%~nf.pdf  +  %%~nf.png
     set /a N+=1
  ) else (
     echo    [fallo] %%~nxf
  )
)

echo.
if !N!==0 (
  echo No se encontro ningun .svg en esta carpeta.
  echo Exporta el plano desde la app con el boton "Plano vectorial (.svg)" y guardalo aqui.
) else (
  echo Listo: !N! plano^(s^) convertidos.
  echo Archivos en: %SAL%
  start "" "%SAL%"
)
echo.
pause
