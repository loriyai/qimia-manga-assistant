#!/bin/sh
set -eu

cd "$(dirname "$0")" || exit 1

echo "七秒漫剧助手依赖安装器（macOS）"
echo "将检查并安装 Node.js、Syncthing，然后安装项目依赖。"
echo

export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_ENV_HINTS=1

if ! command -v brew >/dev/null 2>&1; then
  echo "未检测到 Homebrew，开始安装 Homebrew。"
  echo "安装过程可能需要输入电脑密码。"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi

if [ -x "/opt/homebrew/bin/brew" ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [ -x "/usr/local/bin/brew" ]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js，开始安装 node。"
  brew install node
else
  echo "Node.js 已安装：$(node -v)"
fi

if ! command -v syncthing >/dev/null 2>&1; then
  echo "未检测到 Syncthing，开始安装 syncthing。"
  brew install syncthing
else
  echo "Syncthing 已安装：$(syncthing --version | head -n 1)"
fi

echo
echo "开始安装项目依赖 npm install。"
npm install

echo
echo "依赖安装完成。"
echo "之后可双击 start-mac.command 启动软件。"
echo "Syncthing 可在终端运行 syncthing 后打开 http://127.0.0.1:8384 配置同步。"
echo
echo "按回车键关闭窗口。"
read -r _
