# Marble engine video

## Reference and attribution

- GARBro reference: `ArcFormats/Marble/VideoANIM.cs`, class `AnimOpener`
- GARBro tag: `ANIM/MARBLE`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The header stores the frame count, the frame duration `0x21`, the video dimensions, and an optional
audio track. Both dimensions must stay within 1 and 0x1000, and a non-zero audio size must fit inside
the file.

Behind the header comes a six-byte block per frame, then two tables with one 32-bit offset and one
32-bit size per frame. Frames are named `<archive>#<n padded to 5>.jpg`, and a non-zero audio track is
appended as `<archive>#audio.way`. The format is registered for files without an extension.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| Header validation (frame duration, dimensions) | Supported |
| Frame offset and size tables | Supported |
| Optional audio track entry | Supported |
| Generated frame and audio names | Supported |
| Entry placement validation | Supported |
| Entry listing and extraction | Supported |
| JPEG decoding | Not applicable |
| Archive creation | Unsupported |

Synthetic fixtures cover the frame tables, the audio track, videos without audio, frame duration
rejection, and dimension rejection.
