# AdvSys3 engine resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/AdvSys/ArcAdvSys3.cs`, class `ArcOpener`
- GARBro tag: `ARC/ADVSYS3`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An AdvSys3 archive is a chain of records: a 32-bit payload size, four reserved bytes, a 16-bit name
length, and a CP932 name, followed directly by the payload. A zero size ends the walk. The format
applies only to `.dat` files whose name starts with `arc`.

Payloads that carry a `GWD` marker four bytes into the data have their extension replaced with `gwd`.
GARbro also derives types from payload signatures for every other entry, which the port skips.

## Support

| Capability | Status |
| --- | --- |
| Extension and file name prefix detection | Supported |
| Sequential record chain | Supported |
| Zero-size terminator | Supported |
| Truncated final record | Supported |
| `GWD` extension rewrite | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Entry type inference | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover the record chain, the `GWD` rewrite, file name prefix rejection, and payload
size rejection.
