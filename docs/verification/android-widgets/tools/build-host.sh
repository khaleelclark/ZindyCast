#!/usr/bin/env bash
set -euo pipefail
sdk="${ANDROID_HOME:?Set ANDROID_HOME}"
tools="$sdk/build-tools/36.0.0"
source_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
output="${1:?Supply a temporary output directory}"
mkdir -p "$output/classes" "$output/dex"
"$tools/aapt" package -f -M "$source_dir/AndroidManifest.xml" -I "$sdk/platforms/android-36/android.jar" -F "$output/host.apk"
javac -source 8 -target 8 -classpath "$sdk/platforms/android-36/android.jar" -d "$output/classes" "$source_dir/WidgetHost.java"
"$tools/d8" --lib "$sdk/platforms/android-36/android.jar" --output "$output/dex" "$output"/classes/family/zindycast/widgetcheck/*.class
python3 - "$output" <<'PY'
import sys, zipfile
from pathlib import Path
output = Path(sys.argv[1])
with zipfile.ZipFile(output / 'host.apk', 'a') as apk:
    apk.write(output / 'dex/classes.dex', 'classes.dex')
PY
"$tools/zipalign" -f 4 "$output/host.apk" "$output/aligned.apk"
"$tools/apksigner" sign --ks "$source_dir/../../../../apps/mobile/android/app/debug.keystore" --ks-pass pass:android --key-pass pass:android --out "$output/widget-host.apk" "$output/aligned.apk"
