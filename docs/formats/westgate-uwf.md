# West Gate UWF audio archive

## Reference and attribution

- GARBro reference: `Legacy/WestGate/ArcUWF.cs`, class `UwfOpener`, with the shared `UcaTool`
- GARbro tag: `UWF`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive reserves a fixed 0x1500-byte head. The word at 0x14FC must land inside the file and at or
behind that head, and the entry count is derived from how far it sits beyond the index start at 0x14F0
divided by the record width, so the index width itself encodes the count. The index is read through the
same shared WestGate reader as the UCA graphics archive, and the reference registers the format for the
`uwf` and `arc` extensions.

`UwfOpener.OpenEntry` rewrites each payload as a RIFF/WAVE stream. The format block length sits at the
entry start and the PCM length follows that block; when either length fails to fit inside the entry, the
reference copies the payload verbatim. Otherwise it emits a synthesized header made of `RIFF`, a size,
`WAVE`, `fmt `, the format length and the format block, then the `data` magic, and finishes with the PCM
length word and the PCM bytes. Two details are mirrored exactly: the offset of the format block, and the
RIFF size, which the reference computes as `0x1C + fmt_size + pcm_size` rather than subtracting the
eight bytes the format requires. The port detects the synthesized case while reading the index so
listing and extraction agree, exposes the format and PCM sizes as metadata, and marks those entries as
having an inexact size because the output is longer than the stored span.

## Support

| Capability | Status |
| --- | --- |
| 0x1500-byte reserved head | Supported |
| First offset bounds and derived entry count | Supported |
| Shared WestGate index reader | Supported |
| RIFF header synthesis in front of the PCM bytes | Supported |
| Verbatim extraction when the layout does not fit | Supported |
| Format and PCM size metadata | Supported |
| `.uwf` and `.arc` extension requirement | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a synthesized WAV, a verbatim payload, the extension requirement, and a first
offset inside the reserved head.
