@echo off
setlocal
cd /d "%~dp0"
set PORT=4000
set URL=http://127.0.0.1:%PORT%

echo ==========================================
echo   NIMR Carrosserie - Demarrage local
echo ==========================================
echo.
echo Adresse : %URL%
echo.

where py >nul 2>nul
if %errorlevel%==0 (
  set PYTHON_CMD=py -3
) else (
  set PYTHON_CMD=python
)

start "NIMR Carrosserie - Serveur" cmd /k "%PYTHON_CMD% -m http.server %PORT%"
timeout /t 2 /nobreak >nul

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "NIMR Carrosserie" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%URL%"
  goto done
)

if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  start "NIMR Carrosserie" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%URL%"
  goto done
)

if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
  start "NIMR Carrosserie" "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" "%URL%"
  goto done
)

if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  start "NIMR Carrosserie" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%URL%"
  goto done
)

if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
  start "NIMR Carrosserie" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" "%URL%"
  goto done
)

echo Navigateur non trouve automatiquement.
echo Ouvre manuellement cette adresse dans Chrome : %URL%

goto done

:done
echo.
echo Si la page ne s'ouvre pas, copie cette adresse dans Chrome : %URL%
echo Ne ferme pas la fenetre du serveur pendant l'utilisation.
endlocal
