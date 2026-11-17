#!/usr/bin/env bash
set -euo pipefail
work="$1"
arch="$2"
[[ "$(uname -s)" == Darwin ]] || exit 1
case "$arch" in arm64) macho=arm64; pyarch=aarch64; cliarch=arm64 ;; x64) macho=x86_64; pyarch=x86_64; cliarch=amd64 ;; *) exit 1 ;; esac
app="$work/app"
runtime="$work/runtime"
mkdir -p "$runtime/node" "$runtime/ffmpeg" "$runtime/cli" "$work/download"
download() { curl -fLsS --retry 3 "$1" -o "$2"; }
download "https://nodejs.org/dist/v24.19.0/node-v24.19.0-darwin-$arch.tar.gz" "$work/download/node.tar.gz"
case "$arch" in arm64) sha=8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d ;; x64) sha=d1b5e999db158c62fe8f7267a4476b035d8bd93b1a605bac24a3f0dd166e3316 ;; esac
echo "$sha  $work/download/node.tar.gz" | shasum -a 256 -c -
tar -xzf "$work/download/node.tar.gz" -C "$work/download"
cp "$work/download/node-v24.19.0-darwin-$arch/bin/node" "$runtime/node/node"
cp "$work/download/node-v24.19.0-darwin-$arch/LICENSE" "$runtime/node/LICENSE"
for tool in ffmpeg ffprobe; do
 download "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/$tool-darwin-$arch.gz" "$work/download/$tool.gz"
 gzip -dc "$work/download/$tool.gz" > "$runtime/ffmpeg/$tool"
 chmod +x "$runtime/ffmpeg/$tool"
 lipo "$runtime/ffmpeg/$tool" -verify_arch "$macho"
done
download "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/darwin-$arch.LICENSE" "$runtime/ffmpeg/LICENSE"
download "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/darwin-$arch.README" "$runtime/ffmpeg/README"
"$JAVA_HOME/bin/jlink" --add-modules java.se,jdk.crypto.ec,jdk.httpserver,jdk.unsupported,jdk.unsupported.desktop --strip-debug --no-header-files --no-man-pages --compress=2 --output "$app/resources/yunx/runtime/runtime"
lipo "$app/resources/yunx/runtime/runtime/bin/java" -verify_arch "$macho"
download "https://lf3-static.bytednsdoc.com/obj/eden-cn/psj_hupthlyk/ljhwZthlaukjlkulzlp/dreamina_canvas_cli/dreamina-canvas_darwin_$cliarch" "$runtime/cli/dreamina-canvas"
download "https://liblibai-web-static.liblib.cloud/cli/1.2.0/libtv-macos-$arch.zip" "$work/download/libtv.zip"
unzip -q "$work/download/libtv.zip" -d "$work/download/libtv"
libtv="$(find "$work/download/libtv" -type f -name libtv -print -quit)"
test -n "$libtv"
cp "$libtv" "$runtime/cli/libtv"
chmod +x "$runtime/cli/"*
for tool in libtv dreamina-canvas; do lipo "$runtime/cli/$tool" -verify_arch "$macho"; done
python_name="cpython-3.13.18+20261110-$pyarch-apple-darwin-install_only_stripped.tar.gz"
gh release download 20261110 --repo astral-sh/python-build-standalone --pattern "$python_name" --dir "$work/download"
python_sha="$(gh api repos/astral-sh/python-build-standalone/releases/tags/20261110 --jq '.assets[] | select(.name == "'"$python_name"'") | .digest' | sed 's/^sha256://')"
[[ "$python_sha" =~ ^[a-f0-9]{64}$ ]]
echo "$python_sha  $work/download/$python_name" | shasum -a 256 -c -
tar -xzf "$work/download/$python_name" -C "$work/download"
mv "$work/download/python" "$runtime/chushou-runtime"
"$runtime/chushou-runtime/bin/python3" -m pip install --only-binary=:all: --no-compile --target "$runtime/chushou-runtime/packages" -r packaging/macos/requirements.txt
# Packages are loaded explicitly by the built-in Skill bootstrap, outside user site.
"$runtime/chushou-runtime/bin/python3" -I -c "import sys;sys.path.insert(0,'$runtime/chushou-runtime/packages');import requests,lxml,PIL,yt_dlp,Crypto,gmssl,docx;print('Python tools ready')"
(cd "$app" && npm install --omit=dev --ignore-scripts --no-audit --no-fund)
"$runtime/node/node" --version
"$runtime/cli/dreamina-canvas" version
"$runtime/cli/libtv" --version
"$runtime/ffmpeg/ffmpeg" -hide_banner -loglevel error -f lavfi -i 'color=c=blue:s=64x64:r=10:d=1' -c:v libx264 -pix_fmt yuv420p "$work/media-smoke.mp4"
"$runtime/ffmpeg/ffprobe" -v error -show_entries stream=codec_type -of json "$work/media-smoke.mp4"
