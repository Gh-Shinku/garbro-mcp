# Eushully audio archive

## Reference and attribution

- GARBro reference: `ArcFormats/Eushully/ArcGPC.cs`, classes `HOpener` and `SndOpener`
- GARbro tag: `SND`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

This archive shares the companion-index reader of its graphic sibling, with `.snd` indexed by `.snh`. Entries
gain a `.wav` extension from the reference and are classified as audio.

Extraction differs from the siblings because the stored payload is not a complete wave file: the reference
synthesizes a RIFF header in front of it. Sixteen format bytes are copied out of the payload starting one byte
in, the PCM length is read from a word fifteen bytes in, and the header places those pieces around a `fmt ` chunk
of sixteen bytes and a `data` chunk whose size is that word. Everything from the seventeenth payload byte onward
is then emitted as the audio data, so the extracted span is 0x2C bytes longer than the stored one and those
entries are marked as having an inexact size.

A payload shorter than 0x16 bytes is emitted verbatim instead, since there would be no room for the fields the
header needs.

## Support

| Capability | Status |
| --- | --- |
| Companion index name derived from the extension | Supported |
| Appended `.wav` extension and audio classification | Supported |
| Offset sorting with derived sizes | Supported |
| Synthesized RIFF header with its `fmt ` and `data` chunks | Supported |
| Verbatim fallback for short payloads | Supported |
| Inexact size marking for synthesized entries | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a synthesized wave file with its expected header and PCM bytes.
