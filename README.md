# AI gaming news shorts (fully online)

Everything runs on GitHub. No local computer needed.

## How it works
1. **News scan** (`Gaming news scan` workflow, runs daily at 04:00 UTC or by hand): Reddit (what GitHub is allowed to read)
   plus gaming site feeds. Result: `news/YYYY-MM-DD.md` on the `renders` branch, with article facts and image links.
2. **Story file**: a small JSON in `stories/` (headline, script of about 65 to 80 words, images, optional voice).
3. **Render** (`Render short` workflow, starts automatically when a story file is committed): ElevenLabs voice, Remotion video.
   Result: `videos/<id>.mp4` on the `renders` branch, previews of the images in `assets/<id>/`, the log in `logs/render.log`.

## Story file
    {
      "id": "unique-name",
      "headline": "Text at the top of the video",
      "source": "Source: IGN",
      "script": "About 65 to 80 words.",
      "voice": "optional ElevenLabs voice id (see voices/voices.md on the renders branch)",
      "images": [
        "https://direct-image-url.jpg",
        "steam:Game Name"
      ]
    }
- `steam:Game Name` pulls the official key art and screenshots from the game's Steam page.
- Voice speed: Daniel about 2.2 words per second, Liam about 2.65. Aim for 30 seconds.
- Default voice for all stories: set `voice` in `config.json`.

## Workflows
- `Gaming news scan`, `List ElevenLabs voices`, `Render short` (pick a story file by hand if needed).
- Needs the repo secret `ELEVENLABS_API_KEY`.

## Local use (optional)
    npm install
    npm run make -- stories/<name>.json
