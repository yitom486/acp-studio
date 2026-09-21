@echo off
REM Antigravity ACP Stdio Launcher for Zed Editor on Windows
REM Ensures clean environment and runs sdk-server.ts via Bun
bun run "%~dp0scratch\repos\yitom486-agy-acp-map\src\sdk-server.ts"
