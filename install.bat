@echo off
setlocal EnableDelayedExpansion

title RIST Multi-Receiver Installer

echo.
echo ============================================================
echo   RIST Multi-Receiver - Installer (Windows)
echo ============================================================
echo.

:: Check Docker
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker is not installed or not running!
    echo Please make sure Docker Desktop is installed and started.
    echo Download: https://www.docker.com/products/docker-desktop/
    pause
    exit /b 1
)

echo [1/3] Docker Desktop detected.
echo.

:: Port detection for TCP 3000
set WEB_PORT=3000

:CHECK_PORT
netstat -ano | findstr /R /C:":%WEB_PORT% .*LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    echo [!] Port %WEB_PORT% is already in use by another program.
    set /a WEB_PORT+=1
    echo     Trying port !WEB_PORT!...
    goto CHECK_PORT
)

echo [2/3] Using free port: %WEB_PORT% for Web Management UI.
echo.

:: Detect primary LAN IP via PowerShell
for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Wi-Fi*','Ethernet*' | Where-Object { $_.IPAddress -notlike '172.*' -and $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1).IPAddress"`) do (
    set HOST_IP=%%i
)

if "%HOST_IP%"=="" (
    set HOST_IP=127.0.0.1
)

echo [3/3] Detected LAN IP: %HOST_IP%
echo.

:: Write .env file
echo PORT=%WEB_PORT% > .env
echo HOST_IP=%HOST_IP% >> .env
echo [OK] Configuration saved to .env
echo.

:: Start Docker Compose
echo Starting RIST Multi-Receiver via Docker Compose...
docker compose up -d --build

echo.
echo ============================================================
echo   Installation Complete!
echo ============================================================
echo.
echo   Web Dashboard: http://localhost:%WEB_PORT%
echo   LAN Dashboard: http://%HOST_IP%:%WEB_PORT%
echo.
echo   Check your API Key with: type data\.apikey
echo ============================================================
echo.
pause
