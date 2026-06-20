@echo off
setlocal
cd /d "%~dp0"

echo 七秒漫剧助手依赖安装器（Windows）
echo 将检查并安装 Node.js、Syncthing，然后安装项目依赖。
echo.

where winget >nul 2>nul
if errorlevel 1 (
  echo 未检测到 winget。
  echo 请先从 Microsoft Store 安装“应用安装程序”，或手动安装 Node.js 和 Syncthing。
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js，开始通过 winget 安装 Node.js LTS。
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
) else (
  for /f "delims=" %%v in ('node -v') do echo Node.js 已安装：%%v
)

where syncthing >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Syncthing，开始通过 winget 安装 Syncthing。
  winget install -e --id Syncthing.Syncthing --accept-package-agreements --accept-source-agreements
) else (
  echo Syncthing 已安装。
)

set "PATH=%ProgramFiles%\nodejs;%PATH%"

where npm >nul 2>nul
if errorlevel 1 (
  echo npm 仍不可用。请关闭此窗口后重新双击本文件，或重启电脑后再试。
  echo.
  pause
  exit /b 1
)

echo.
echo 开始安装项目依赖 npm install。
npm install
if errorlevel 1 (
  echo npm install 失败，请检查网络或 npm 输出。
  echo.
  pause
  exit /b 1
)

echo.
echo 依赖安装完成。
echo 之后可双击 start-windows.bat 启动软件。
echo Syncthing 可在开始菜单中打开，或运行 syncthing 后打开 http://127.0.0.1:8384 配置同步。
echo.
pause
