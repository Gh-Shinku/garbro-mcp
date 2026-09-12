# Tanaka BMX archive

## Reference and attribution

- GARBro reference: `ArcFormats/Tanaka/ArcBMX.cs`, class `BmxOpener`
- GARBro tag: `BMX`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`BMX` archives store a 32-bit total size at offset 0 that must equal the file size and a
32-bit entry count at 4. The index starts at 0x10 and uses 0x20-byte records with a 28-byte
CP932 name and a 32-bit offset at +0x1c. The name walk stops at the first empty name; sizes run
from each offset to the next, and the last entry ends at the end of file.

## Support

| Capability | Status |
| --- | --- |
| Total-size validation | Supported |
| Derived entry sizes | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
