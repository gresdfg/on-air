@echo off
cd /d "%~dp0"
if /i "%~1"=="-elevated" goto run
powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs -ArgumentList '-elevated'"
exit /b
:run
echo Adding inbound rule for TCP 7790 (private network only)...
netsh advfirewall firewall add rule name="ON AIR 7790" dir=in action=allow protocol=TCP localport=7790 profile=private
echo.
echo Done. Close this window and try the phone again.
pause
