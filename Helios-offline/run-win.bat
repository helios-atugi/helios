@echo off
cd /d %~dp0
npx --yes serve -l 5174 dist
