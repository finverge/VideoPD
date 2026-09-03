@echo off
setlocal

:: ============================================================================
:: VideoPD 2.0 prototype - start/restart all local services
::
:: Run this by double-clicking it, or from a terminal: run.bat
:: Each service opens in its own console window with a labeled title.
:: To STOP a service, close its window (or Ctrl+C inside it).
:: To RESTART a service, close its window and run this script again -
:: it's safe to re-run any time; it only opens new windows, it doesn't
:: touch anything already running.
:: ============================================================================

set "PROJECT_ROOT=D:\Finverge\Docs\Products\VideoPD\sourcecode"
set "VOICE_SERVICE_DIR=%PROJECT_ROOT%\voice-service"
set "PYTHON_EXE=C:\Users\finve\AppData\Local\Programs\Python\Python312\python.exe"

echo.
echo Starting VideoPD 2.0 local services...
echo.

echo [1/3] Next.js app (borrower portal + underwriter workspace) - port 3000
start "VideoPD - Next.js App" cmd /k "cd /d "%PROJECT_ROOT%" && npm run dev"

echo [2/3] Signaling server (WebRTC live-call rooms) - ws://localhost:4001
start "VideoPD - Signaling Server" cmd /k "cd /d "%PROJECT_ROOT%" && npm run dev:signaling"

echo [3/3] Voice-biometrics / deepfake / lip-sync microservice - port 8077
start "VideoPD - Voice Service" cmd /k "cd /d "%VOICE_SERVICE_DIR%" && "%PYTHON_EXE%" -m uvicorn main:app --port 8077"

echo.
echo All three services are launching in separate windows - give them a
echo few seconds (the voice service in particular can take a bit to load
echo its models on first request).
echo.
echo   Borrower portal (DLP):     http://localhost:3000
echo   Underwriter workspace:     http://localhost:3000/staff
echo.
echo Notes:
echo   - If port 3000 is already taken by something else, Next.js will
echo     pick the next free port automatically - check that window's
echo     own output for the actual URL it prints.
echo   - The voice service is optional: the rest of the app works fully
echo     without it; "Run voice check" just reports it as unreachable.
echo   - VideoPD session links (/videopd/[token]) and call links
echo     (/call/[token]) are per-application, generated from a case page
echo     in the underwriter workspace - there's no fixed URL for those.
echo.
echo Optional, not started by this script: a local TURN relay (coturn),
echo for calls to connect across real-world networks STUN alone can't
echo traverse. Needs Docker Desktop running. See README.md's "Running
echo locally" section for the exact docker run command.
echo.

endlocal
