#!/usr/bin/env bash
# Regenerates the seed fixture media (committed; run only to change them).
# Needs ImageMagick 7 (magick) and ffmpeg. Output is small on purpose: under 300 KB in total.
set -euo pipefail
cd "$(dirname "$0")"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

FONT=DejaVu-Sans
W=1280 H=720

# A plain mock of the lab page: top bar, heading, three buttons, a list, a status line.
page() {
  magick -size ${W}x${H} xc:'#f7f5f0' \
    -fill '#1f2333' -draw "rectangle 0,0 ${W},56" \
    -font $FONT -fill '#ffffff' -pointsize 20 -annotate +24+36 'Lab shop' \
    -fill '#1f2333' -pointsize 34 -annotate +64+130 'Checkout' \
    -fill '#3446cf' -draw 'roundrectangle 64,170 264,218 8,8' \
    -fill '#ffffff' -pointsize 18 -annotate +104+201 'Save (works)' \
    -fill '#3446cf' -draw 'roundrectangle 288,170 520,218 8,8' \
    -fill '#ffffff' -annotate +320+201 'Submit order' \
    -fill '#3446cf' -draw 'roundrectangle 544,170 704,218 8,8' \
    -fill '#ffffff' -annotate +592+201 'Sync' \
    -fill '#e7e3da' -draw 'rectangle 64,250 1216,640' \
    -fill '#1f2333' -pointsize 16 \
    -annotate +88+290 'Item 1   Notebook          2 x 4.50' \
    -annotate +88+330 'Item 2   Fountain pen      1 x 18.00' \
    -annotate +88+370 'Item 3   Ink, blue-black   3 x 6.25' \
    -annotate +88+410 'Total                      45.75' \
    -fill '#6b6f80' -annotate +64+680 'Order status: saved' \
    "$1"
}

page "$tmp/page.png"
cp "$tmp/page.png" screenshot-full.png

# Area crop around the buttons, with annotations flattened in (J-051): rectangle, arrow, text callout.
magick "$tmp/page.png" -crop 720x300+40+120 +repage \
  -fill none -stroke '#f2b100' -strokewidth 5 -draw 'roundrectangle 238,40 490,108 10,10' \
  -stroke '#d6336c' -strokewidth 5 -draw 'line 600,230 500,110' -draw 'line 500,110 530,118' -draw 'line 500,110 507,140' \
  -stroke none -fill '#d6336c' -draw 'roundrectangle 520,220 712,270 10,10' \
  -font $FONT -fill '#ffffff' -pointsize 18 -annotate +536+252 'Nothing happens' \
  screenshot.png

# A pointer dot that walks to Submit order and clicks it.
magick -size 24x24 xc:none -fill '#d6336c' -stroke '#ffffff' -strokewidth 3 -draw 'circle 12,12 12,3' "$tmp/dot.png"

ffmpeg -loglevel error -y -loop 1 -framerate 10 -t 8 -i "$tmp/page.png" -i "$tmp/dot.png" \
  -f lavfi -t 8 -i anullsrc=r=48000:cl=mono \
  -filter_complex "[0][1]overlay=x='min(150+t*60,400)':y='min(400-t*40,190)'" \
  -c:v libvpx-vp9 -b:v 120k -deadline good -cpu-used 4 -row-mt 1 -g 30 -c:a libopus -b:a 16k -shortest tab-video.webm 2>/dev/null \
|| ffmpeg -loglevel error -y -loop 1 -framerate 10 -t 8 -i "$tmp/page.png" -i "$tmp/dot.png" \
  -f lavfi -t 8 -i anullsrc=r=48000:cl=mono \
  -filter_complex "[0][1]overlay=x='min(150+t*60,400)':y='min(400-t*40,190)'" \
  -c:v libvpx -b:v 150k -c:a libopus -b:a 16k -shortest tab-video.webm

ffmpeg -loglevel error -y -ss 4 -i tab-video.webm -frames:v 1 -vf scale=480:-2 -q:v 70 tab-video.thumb.webp
magick screenshot.png -resize 480x screenshot.thumb.webp

ls -l *.png *.webm *.webp
