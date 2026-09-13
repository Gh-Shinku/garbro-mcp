# NEJII engine PCD resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Nejii/ArcPCD.cs`, class `PcdOpener`
- GARBro tag: `PCD/NEJII`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `.pcd` file is a chain of audio records. Before doing anything else, GARbro validates the first
record as a wave format: one or two channels, a byte rate equal to block alignment times the sample
rate, and 8 or 16 bits per sample.

Each record holds a 0x10-byte CP932 name, a 0x10-byte wave format at +0x10, and a 0x20-byte header
whose last eight bytes are the data offset and a 32-bit size. The entry covers four bytes past that
size, which means the leading size word belongs to the payload. Extraction prepends a 40-byte RIFF
header built from the record's own wave format: `RIFF`, the size, `WAVE`, `fmt `, the format `0x10`
chunk, the stored 16-byte format, and the `data` marker.

## Support

| Capability | Status |
| --- | --- |
| Extension and wave format validation | Supported |
| Chained record walk | Supported |
| Stored size word handling | Supported |
| Per-record wave format in the generated header | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the record chain, the wave format validation, the generated headers, and
extension rejection.
