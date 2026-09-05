# Junction private-beta launch — 30 seconds

Editable Remotion 4.0.521 project, six separately editable scenes, landscape + vertical, two stills. Matches the cream/navy/blue public page. No client metrics, recordings or credentials. The work pack is explicitly illustrative. Original instrumental soundtrack; no third-party samples or voice cloning.

## Reproduce

```sh
npm ci
node soundtrack.mjs
npm run lint
npx remotion studio --no-open --port 4180
npx remotion render src/index.ts Junction-Launch out/junction-launch-30s.mp4 --codec=h264 --crf=18 --concurrency=3
npx remotion render src/index.ts Junction-Vertical out/junction-launch-30s-vertical.mp4 --codec=h264 --crf=18 --concurrency=3
npx remotion still src/index.ts Junction-Cover out/junction-cover.png
npx remotion still src/index.ts Junction-Social out/junction-social.png
```

## Verified output

- Landscape: 1920×1080, H.264, **900 frames / 30fps / 30.000 seconds video**, stereo AAC 48kHz, 2,851,445 bytes.
- Vertical: 1080×1920, same timing/codecs, 2,789,798 bytes.
- MP4 container duration: 30.058667 seconds because of AAC encoder padding. The visual program is exactly 30 seconds.
- Both files decode fully with FFmpeg error-as-fatal and explicit rawvideo/PCM null output. Initial default null encoder was unavailable in the bundled build; the explicit-codec check passes.
- Scene stills and both cover layouts visually inspected. The preview opens at http://localhost:4180/Junction-Launch. Main/independent-project TypeScript and Remotion lint pass.
- Runtime dependency audit: zero reported vulnerabilities. Scaffold installation reported two low-severity development dependency findings; no forced broad upgrade performed.

SHA-256 landscape: `15160f17cf860a175eb74f1387deab41b2370e8f7d82b46e57ebd37d16f7598e`

SHA-256 vertical: `63389c0711ead2e4098e979635b149f1e140a4bd9a3d5ac23d5ac934cd32bc0a`

The rendered assets are ready for Tom's review. No social publishing, customer email send or paid campaign was performed. Copy, claims boundaries and distribution checklist: ../launch-materials/LAUNCH-PACK.md. Full Unc backend acceptance remains separate and open.
