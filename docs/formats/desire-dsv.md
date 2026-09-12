# Desire DSV archive

## Reference and attribution

- GARBro reference: `Legacy/Desire/ArcDSV.cs`, class `D000Opener`
- GARBro tag: `000/DESIRE`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2018 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`DSV` archives are detected by the `.000`..`.003` extensions together with an ASCII first
byte. The index starts at offset 0 and uses 0x10-byte records with a 12-byte CP932 name and a
32-bit size at +0x0c; the walk stops at the first zero name byte. The terminating record must
have a zero size field, payloads follow the index sequentially, and the last payload must end
exactly at the end of file.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Zero-byte index terminator | Supported |
| Sequential payloads | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
