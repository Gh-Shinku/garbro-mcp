# Silky's AWF audio archive

## Reference and attribution

- GARBro reference: `ArcFormats/Silky/ArcAWF.cs`, class `AwfOpener`
- GARBro tag: `AWF`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `AWF` archive starts with a 32-bit record count and an index at 4 with 0x34-byte records: a
0x20-byte CP932 name, the data offset at +0x20, the size at +0x24, and twelve unused bytes. The
format is only accepted for `.awf` files.

GARbro decides the payload type from the file name. Files named `voice.awf` hold MP3 data and their
entries receive a `.mp3` extension with no further processing; every other archive is treated as raw
PCM, and extraction prepends a fixed 44-byte WAV header (mono/stereo, 22050 Hz, 16-bit) whose data
size matches the stored payload. The port accounts for that header in the entry size so the declared
length stays verifiable.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| 0x34-byte index records | Supported |
| MP3 naming for `voice.awf` | Supported |
| Generated WAV headers for raw payloads | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the record walk, the generated WAV header, the MP3 path, and extension
rejection.
