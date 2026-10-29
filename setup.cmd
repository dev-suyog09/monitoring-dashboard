@echo off
rem One-command setup for the NTRX AppOps dashboard. Double-click it, or run  setup.cmd  in a terminal.
rem Extra options pass straight through:  setup.cmd -Update   setup.cmd -Uninstall   setup.cmd -DryRun
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
set "code=%errorlevel%"
rem stay open only when started by double-click (no arguments), so the result can be read
if "%~1"=="" pause
exit /b %code%
