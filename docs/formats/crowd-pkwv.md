# Crowd engine audio archives (PKWV)

## Reference and attribution

- GARBro reference: `ArcFormats/Crowd/ArcPCK.cs`, class `PkwOpener`
- GARBro tag: `PKWV`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The audio archive is recognised by its `PKWV` signature, and the reference registers it as the `PCK` extension
as well, so the port keeps `pck` in its extension hints.

## Layout

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 4 | `PKWV` signature |
| 0x04 | 2 | Wave format count |
| 0x06 | 2 | Entry count |
| 0x08 | 0x14 × formats | Wave format records |
| … | 0x18 × entries | Entry records |
| … | … | Raw PCM payloads |

Both counts must be non-zero, and the offset behind both tables must lie inside the file.

A wave format record holds a 16-bit format tag, a 16-bit channel count, a 32-bit sample rate, a 32-bit average
bytes per second, a **16-bit bits-per-sample at +0x0C and a 16-bit block align at +0x0E**.

An entry record holds a 16-bit format index, a ten-byte CP932 name at +2, a 32-bit stored size at +0x0C and a
64-bit payload offset at +0x10 that is relative to the end of both tables. The reference indexes its format list
without a range check, so an index at or beyond the format count declines the archive rather than being reported;
the port treats it the same way. Every entry is named `<name>.wav` and its payload is stored as raw PCM.

## Extraction

Because the payloads carry no container, the reference prepends a RIFF header when an entry is opened, and the
port reproduces that header field for field:

```
'RIFF'        32-bit size = 0x24 + packed size
'WAVE'
'fmt '        32-bit 0x10
16-bit format tag, 16-bit channels, 32-bit sample rate, 32-bit average bytes per second,
16-bit block align, 16-bit bits per sample
'data'        32-bit packed size
```

The header writes the block align **before** the sample width, which is the opposite order from the format
records it was read from, so an entry reports its stored size as packed size and that size plus 0x2C as its size.

## Support

| Capability | Status |
| --- | --- |
| `PKWV` signature and both count fields | Supported |
| 0x14-byte wave format records | Supported |
| 0x18-byte entry records with 64-bit offsets | Supported |
| Format index selection and declining out-of-range indexes | Supported |
| Ten-byte CP932 names with a `wav` suffix | Supported |
| Stored size as packed size, plus 0x2C as the entry size | Supported |
| Placement checks against the file size | Supported |
| RIFF header generation with the reference's field order | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover two entries with different wave formats and their generated headers, an out-of-range
format index, empty format and entry tables, a base offset outside the archive, a payload outside the archive, a
wrong signature, a truncated entry table, and the header's block align position ahead of the sample width.
