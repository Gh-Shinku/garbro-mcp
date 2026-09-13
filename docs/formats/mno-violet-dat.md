# M no Violet resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/MnoViolet/ArcMnoViolet.cs`, class `DatOpener`
- GARBro tag: `MNV`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `DAT` archive starts with a 32-bit record count and an index at 4. The name field width is not
stored, so GARbro probes 100, 68, and 44 bytes in order: a candidate is accepted only when the first
data offset equals `4 + (name_width + 8) * count` and every record has a non-blank name, an offset
that is larger than the derived index size, and a valid data range. A record tail holds the stored
size followed by the data offset.

GARbro derives entry types from payload signatures and maps a leading `1` to its GRA image format;
the port keeps the stored names.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Name width probing | Supported |
| First-offset validation | Supported |
| Per-record validation with candidate retry | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Entry type inference | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover a 100-byte index, the narrower-width probe, offset rejection, and extension
rejection.
