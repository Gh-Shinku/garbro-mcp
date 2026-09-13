# ScenePlayer PMX scripts archive

## Reference and attribution

- GARBro reference: `ArcFormats/ScenePlayer/ArcPMX.cs`, class `PmxOpener`
- GARBro tag: `PMX`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `.pmx` file is an obfuscated zlib stream: every byte is XORed with 0x21, which turns the zlib
header byte 0x78 into 0x59 and is the first thing GARbro checks. The inflated stream holds a 32-bit
record count and records of a 0x20-byte CP932 name plus the script size. Scripts follow the index in
order, so each entry is a slice of the decoded stream. Blank and rooted names are rejected.

The port decodes the stream into memory when the archive is opened, because entry ranges refer to the
decoded bytes rather than to the stored file.

## Support

| Capability | Status |
| --- | --- |
| Extension and XORed zlib header detection | Supported |
| XOR-0x21 and zlib decoding | Supported |
| Sequential script records | Supported |
| Blank and rooted name rejection | Supported |
| Entry range validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the decoded stream, sequential entries, rooted name rejection, and extension
rejection.
