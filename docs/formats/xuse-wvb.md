# Xuse WVB audio resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Xuse/ArcWVB.cs`, class `WvbOpener`
- GARBro tag: `WVB`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive has no separate header: the 32-bit word at 4 is the offset field of the first record, and
GARbro derives the data start from it by subtracting one and dividing by eight to get the record
count. Because that field is shared, the first payload begins exactly at the end of the index and
therefore also covers the `fmt` chunk and the `data` marker that follow it.

Records are eight bytes with a stored size and a data offset. GARbro walks the table until one of the
offsets is zero and requires the declared size to be at least eight bytes, since the first eight are
dropped before the payload is exposed. A `data` marker behind the `fmt` chunk validates the layout.

Extraction prepends a 16-byte RIFF header (`RIFF`, the final size minus eight, `WAVE`, `fmt `) whose
length is folded into the entry size so the declared length stays verifiable.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| Shared first-offset indicator | Supported |
| Eight-byte record table | Supported |
| `fmt`/`data` marker validation | Supported |
| Generated RIFF headers | Supported |
| Entry placement validation | Supported |
| Generated entry names | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the record walk, the generated RIFF header, marker rejection, and first
offset alignment rejection.
