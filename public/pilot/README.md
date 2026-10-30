# Pilot media for the landing

Everything in this folder is served as is, at `/pilot/<file>`. Nothing shows on the landing until you
set its constant in `lib/marketing/pilot.ts`. The table video and the before and after photos also need
`PILOT_COPY = true`, which you set only once the dealer has agreed in writing (they show a real store).
With nothing set, the example stores follow the hero and the page is complete as it is.

## 1. The table video (right under the hero)

1. Make the two files from your phone's clip, from the repo's root folder (one command; change the
   input path to your clip):

   ```sh
   ffmpeg -t 20 -i ~/Desktop/IMG_1234.MOV \
     -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30,format=yuv420p" \
     -c:v libx264 -profile:v high -preset slow -crf 23 -maxrate 5M -bufsize 10M \
     -an -movflags +faststart -map_metadata -1 public/pilot/table.mp4 \
     -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080" \
     -frames:v 1 -q:v 3 -map_metadata -1 public/pilot/table-poster.jpg

   ls -lh public/pilot
   ```

   That writes `table.mp4` (1080p H.264, no sound, starts playing before it finishes downloading) and
   `table-poster.jpg` (its first frame, shown before it plays and under reduced motion), and drops the
   phone's location and camera data from both.

   - `-t 20` keeps the first 20 seconds. Add `-ss 3` before it to skip the first 3 seconds; the poster is
     always the first frame of what you keep, so start on a frame that reads well (the table, not a blur).
   - Check the size: aim for under about 15 MB. If it's bigger, lower `-t` or change `-crf 23` to `-crf 26`.
   - To keep the sound, replace `-an` with `-c:a aac -b:a 128k`, and add `sound: true` in step 2 so the
     video gets a sound button. It still starts muted.
   - If the video looks grey or washed out, the phone recorded in HDR. Turn off HDR video in the camera
     settings and film again, or export the clip from Photos as a regular (SDR) video first.

2. In `lib/marketing/pilot.ts`, set `PILOT_COPY = true` and replace the `null` in the `PILOT_MEDIA` line:

   ```ts
   export const PILOT_COPY = true;

   export const PILOT_MEDIA: PilotMedia | null = { kind: "video", src: "/pilot/table.mp4", poster: "/pilot/table-poster.jpg", caption: PILOT_VIDEO_CAPTION };
   ```

   The caption under the video is `PILOT_VIDEO_CAPTION` in the same file ("Kennesaw, GA · the first table
   Stoop planned"); change the words there if you like.

3. Run `npm run dev` and open the landing: the video sits right under the hero, plays muted once it
   scrolls into view, and has a pause button. Then commit `public/pilot/table.mp4`,
   `public/pilot/table-poster.jpg` and `lib/marketing/pilot.ts`.

Optional: captions for anything said on camera go in `public/pilot/table.vtt` (plain WebVTT text), with
`captions: "/pilot/table.vtt"` added to `PILOT_MEDIA`.

## 2. The walkthrough video (optional, in "How it works")

A longer screen walkthrough, click to play, never autoplays. Make it with the same command and your own
names (for example `demo.mp4` and `demo-poster.jpg`, any length; keep it under about 20 MB, or upload it to
the public Vercel Blob store and use its address), then set `DEMO_VIDEO` in `lib/marketing/pilot.ts`:

```ts
export const DEMO_VIDEO: DemoVideo | null = { src: "/pilot/demo.mp4", poster: "/pilot/demo-poster.jpg", title: "Planning a table in two minutes" };
```

## 3. Before and after photos (optional, under the video)

Two real photos from the pilot: your usual table as it normally looks (`before.jpg`), and the table Stoop
planned on the pilot day (`after.jpg`). A third, `preview.jpg`, is optional: an AI preview, which always
shows an "AI preview" label.

Rules before any photo goes up: everyone you can recognize in it has agreed to be shown; no one under 18;
no location metadata (the script below drops all of it); no carrier logos made bigger or added, and nothing
that reads as the carrier's own ad.

The script turns the photo upright, fits it to 1600 px and writes a JPEG at quality 80 with no metadata:

```sh
npx tsx scripts/pilot-photo.ts ~/Desktop/IMG_1234.HEIC public/pilot/before.jpg
npx tsx scripts/pilot-photo.ts ~/Desktop/IMG_1240.HEIC public/pilot/after.jpg
```

(If your version of sharp can't read HEIC, export the photo as JPEG from Photos first.) Then set
`BEFORE_AFTER` in `lib/marketing/pilot.ts` (with `PILOT_COPY = true`), with alt text that says what is in
each photo:

```ts
export const BEFORE_AFTER: BeforeAfter | null = {
  before: { src: "/pilot/before.jpg", alt: "A folding table outside the store with a sign and balloons", caption: "A usual Friday table" },
  after: { src: "/pilot/after.jpg", alt: "The same spot with hot drinks, a prize wheel and the poster", caption: "The table Stoop planned" },
  preview: { src: "/pilot/preview.jpg", alt: "The planned table, drawn by AI before the day" },
};
```

Drop the `preview` line if there is no AI preview.
