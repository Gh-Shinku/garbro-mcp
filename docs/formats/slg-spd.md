# SLG system SPD audio archive

## Reference and attribution

- GARBro reference: `ArcFormats/Slg/ArcSPD.cs`, class `SpdOpener`
- GARBro tag: `SPD/SLG`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The `.spd` file holds only payloads; its index lives in a sibling `.SPL` file, which GARbro locates
with `Path.ChangeExtension`. The companion must start with `SFP\0`, carries an alignment factor at
0x0c, and stores the name-blob offset at 0x20.

That name-blob offset also sizes the record list: records are counted from 0x20 in 0x10-byte steps,
and the first record's name-offset field is the same word. Every record holds a name offset, the
stored size, and a data offset that GARbro multiplies by the alignment factor before validating it
against the payload file.

## Support

| Capability | Status |
| --- | --- |
| Companion `.SPL` index | Supported |
| Name-blob derived record count | Supported |
| Alignment factor scaling | Supported |
| Name-blob validation | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the companion index, the alignment factor, missing-companion rejection, and
payload extraction.
