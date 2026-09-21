#!/bin/sh
# Makes the icon files phones and browsers ask for, from the design's icon
# (docs/design/icon.svg). Run it again whenever that icon changes.
#
#   public/icon.svg       the browser tab icon and the brand lockup's mark:
#                         the design's file, as is
#   public/favicon.ico    the same, for browsers that can't show SVG
#   public/apple-touch-icon.png, public/icon-192.png, public/icon-512.png
#                         home-screen icons, exported square: DESIGN.md asks
#                         for that because iPhones round an app icon's
#                         corners themselves
#
# app/layout.tsx and app/manifest.ts say where each one is.
# Needs rsvg-convert and ImageMagick: brew install librsvg imagemagick
set -eu
cd "$(dirname "$0")/.."

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

cp docs/design/icon.svg public/icon.svg

# The icon's background is the one shape with 15-unit corners; the module
# tiles on it keep theirs.
sed 's/ rx="15"//' docs/design/icon.svg > "$work/square.svg"
for pair in 180:public/apple-touch-icon.png 192:public/icon-192.png 512:public/icon-512.png; do
  size=${pair%%:*}
  rsvg-convert --width "$size" --height "$size" "$work/square.svg" -o "$work/$size.png"
  # Fully opaque, with no transparency layer at all, and no date stamp,
  # so running this again without an icon change changes nothing.
  magick "$work/$size.png" -alpha off -strip -define png:exclude-chunk=date,time \
    "PNG24:${pair#*:}"
done

for size in 16 32 48; do
  rsvg-convert --width "$size" --height "$size" docs/design/icon.svg -o "$work/tab-$size.png"
done
magick "$work/tab-16.png" "$work/tab-32.png" "$work/tab-48.png" public/favicon.ico
