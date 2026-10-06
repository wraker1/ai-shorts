# AI gaming news shorts

Pipeline: Reddit scan -> script -> ElevenLabs voice -> Remotion render (9:16, Anton captions, slow zoom images).

## One time setup (Windows terminal, in this folder)
    npm install

Your ElevenLabs key is already in `.env` (git ignored). Change the voice with ELEVENLABS_VOICE_ID.

## Test render (no images, placeholder gradients)
    npm run make -- stories/template-test.json
Output: out/template-test.mp4

## Daily
    npm run news                 -> out/news-DATE.md with today's top posts
    (write a story file in stories/, e.g. copy template-test.json)
    npm run make -- stories/<name>.json

## Story file
- id: folder name for assets
- headline: top bar text
- source: small line under the headline
- script: ~75 words for 30 seconds
- images: URLs, or file names placed in public/stories/<id>/
- music (optional): path inside public, e.g. "music/track.mp3"

Preview/tweak the design live: `npm run studio`

## Cloud rendering (GitHub Actions)
Commit a story file to `stories/` and the "Render short" workflow makes the voice and renders the video.
The mp4 is attached to the workflow run as the `shorts` artifact. Requires the repo secret `ELEVENLABS_API_KEY`
(optional repo variable `ELEVENLABS_VOICE_ID`). You can also start it by hand from the Actions tab.
