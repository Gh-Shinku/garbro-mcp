# RED-ZONE PAK archive

## Reference and attribution

- GARBro reference: `Legacy/RedZone/ArcPAK.cs`, class `PakOpener`
- GARBro tag: `PAK/REDZONE`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

RED-ZONE archives have no magic signature. A 32-bit entry count sits at offset 0 and the index
starts at 4. Records are 0x54 bytes with a 0x44-byte CP932 name, a 32-bit absolute offset at
+0x44, and a 32-bit size at +0x48. GARbro requires every offset to point past the end of the
index.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| Index-following offsets | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
