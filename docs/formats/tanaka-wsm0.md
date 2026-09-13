# Tanaka WSM0 music archive

## Reference and attribution

- GARBro reference: `ArcFormats/Tanaka/ArcWSM.cs`, class `Wsm0Opener` with `WaveAudio.WriteRiffHeader`
- GARbro tag: `WSM0`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The signature spells `WSM0`, the word at 4 is the index size and the entry count sits at 8. The index is the
file's *first* `index_size` bytes rather than a region behind a header, so the entries' payloads begin at or
behind that size — the reference rejects an index that reaches the end of the file.

Entries are located indirectly: the words from 0x10 onward are pointers *into that same index buffer*, and each
one addresses a record holding a name length, the name itself — with a terminator counted in that length — and
then, behind the name, a format block and the payload's offset and size. Version zero stores no format at all, so
the reference assumes stereo, sixteen bits and 44.1 kHz.

Extraction synthesizes the canonical 44-byte wave header in front of the payload, so the extracted span is 0x2C
bytes longer than the stored one and those entries are marked as having an inexact size. That header builder is
exported and shared with the version one format, which differs only in reading its format fields from the entry.

## Support

| Capability | Status |
| --- | --- |
| `WSM0` signature and index size | Supported |
| Indirect per-entry records inside the index | Supported |
| Name length including its terminator | Supported |
| Default stereo, sixteen-bit, 44.1 kHz format | Supported |
| Synthesized wave header | Supported |
| Entry placement validation | Supported |
| Inexact size marking for synthesized entries | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover an entry with the default format and, in the version one note, an entry with its own.
