# Pilot media for the landing

Everything in this folder is served as is, at `/pilot/<file>`. Nothing shows on the landing until you
set its constant in `lib/marketing/pilot.ts`. Until then the landing shows the lead example store's real
plan in the video band, and the before and after slot renders nothing.

## 1. The table video (the band under the hero)

Drop these four files here:

| File | What it is |
|---|---|
| `table.mp4` | The video, H.264 (required) |
| `table.webm` | The same video as VP9 WebM (optional, smaller in Chrome and Firefox) |
| `table-poster.jpg` | Its first frame, shown before it plays and under reduced motion |
| `table.vtt` | Captions, if anyone speaks on camera (optional) |

Target: landscape 16:9 at 1280 by 720, 15 to 30 seconds, H.264 at about 2 to 3 Mbps, under about 8 MB.
It plays muted and loops once it scrolls into view; people tap for sound. The first frame is the poster,
so start on a frame that reads well on its own (the table, not a blur).

Make them with ffmpeg (from the folder with your clip, `input.mov` here; `-ss` and `-t` pick 25 seconds
from the 3 second mark, and `-map_metadata -1` drops the phone's location and camera data):

```sh
ffmpeg -ss 3 -t 25 -i input.mov \
  -vf "scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,fps=30" \
  -c:v libx264 -profile:v high -preset slow -b:v 2500k -maxrate 3000k -bufsize 5000k -pix_fmt yuv420p \
  -c:a aac -b:a 128k -movflags +faststart -map_metadata -1 public/pilot/table.mp4

ffmpeg -i public/pilot/table.mp4 -c:v libvpx-vp9 -b:v 1800k -row-mt 1 -c:a libopus -b:a 96k \
  -map_metadata -1 public/pilot/table.webm

ffmpeg -i public/pilot/table.mp4 -frames:v 1 -q:v 3 public/pilot/table-poster.jpg

ls -lh public/pilot
```

If `table.mp4` comes out over about 8 MB, lower `-b:v` to `2000k`, or upload it to the public Vercel Blob
store instead and use its `https://...public.blob.vercel-storage.com/...` address (the site's security
policy allows both).

Captions (`table.vtt`) are plain text:

```
WEBVTT

00:00.000 --> 00:03.500
What you hear in the first few seconds.
```

Then, in `lib/marketing/pilot.ts`:

1. Set `PILOT_VIDEO_CAPTION` to your line (for example "Kennesaw, GA · the first table Stoop planned").
2. Set `PILOT_MEDIA`:

```ts
export const PILOT_MEDIA: PilotMedia | null = {
  kind: "video",
  src: "/pilot/table.mp4",
  webm: "/pilot/table.webm",
  poster: "/pilot/table-poster.jpg",
  captions: "/pilot/table.vtt",
  caption: PILOT_VIDEO_CAPTION,
};
```

Leave out `webm` or `captions` (or set them to `null`) if you don't have them.

## 2. The walkthrough video (optional, in "How it works")

A longer screen walkthrough, click to play, never autoplays. Same steps as above with your own names, for
example `demo.mp4` and `demo-poster.jpg` (any length; keep it under about 20 MB or use Blob), then set
`DEMO_VIDEO` in `lib/marketing/pilot.ts`:

```ts
export const DEMO_VIDEO: DemoVideo | null = { src: "/pilot/demo.mp4", poster: "/pilot/demo-poster.jpg", title: "Planning a table in two minutes" };
```

## 3. Before and after photos (optional, right under the video band)

Two real photos from the pilot: your usual table as it normally looks, and the table Stoop planned on the
pilot day. A third image is optional: an AI preview, which always shows an "AI preview" label.

| File | What it is |
|---|---|
| `before.jpg` | The usual table ("A usual Friday table") |
| `after.jpg` | The table Stoop planned ("The table Stoop planned") |
| `preview.jpg` | Optional AI preview, always labeled "AI preview" |

Rules before any photo goes up:

- Everyone you can recognize in it has agreed to be shown.
- No one under 18 in any photo.
- No location metadata. The script below drops all of it (EXIF, GPS, camera, time).
- No carrier logos made bigger or added, and nothing that reads as the carrier's own ad.

Size: 1600 px on the long side, JPEG quality about 80. The script does exactly that (it also turns the
photo upright first):

```sh
npx tsx scripts/pilot-photo.ts ~/Desktop/IMG_1234.HEIC public/pilot/before.jpg
npx tsx scripts/pilot-photo.ts ~/Desktop/IMG_1240.HEIC public/pilot/after.jpg
```

(If your version of sharp can't read HEIC, export the photo as JPEG from Photos first.)

Then set `BEFORE_AFTER` in `lib/marketing/pilot.ts`, with alt text that says what is in each photo:

```ts
export const BEFORE_AFTER: BeforeAfter | null = {
  before: { src: "/pilot/before.jpg", alt: "A folding table outside the store with a sign and balloons", caption: "A usual Friday table" },
  after: { src: "/pilot/after.jpg", alt: "The same spot with hot drinks, a prize wheel and the poster", caption: "The table Stoop planned" },
  preview: { src: "/pilot/preview.jpg", alt: "The planned table, drawn by AI before the day" },
};
```

Drop the `preview` line if there is no AI preview.
