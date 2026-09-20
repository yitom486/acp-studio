@echo off
REM Antigravity ACP Stdio Launcher for Zed Editor on Windows
REM Ensures clean environment and runs acp-stdio.ts via Bun
bun run "%~dp0server\acp-stdio.ts"
