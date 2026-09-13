# TSD engine MCD resource archive

## Reference and attribution

- GARBro reference: `Legacy/Tsd/ArcMCD.cs`, class `McdOpener`
- GARBro tag: `MCD/TSD`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The header starts with `OLH ` and the marker `for Win`. A trailer in the last eight bytes holds the
index offset and a 32-bit record count; the index itself must fit inside the file. Records are eight
bytes with the data offset and the stored size, and entries are named `<archive>#<n padded to 4>`.

GARbro classifies each entry from the leading signature of its payload — images when the low word is
zero or `BM`, audio when the word is `RIFF` — and the port records that classification in the entry
metadata without renaming anything.

## Support

| Capability | Status |
| --- | --- |
| Signature and marker detection | Supported |
| Trailing index | Supported |
| Eight-byte records | Supported |
| Signature-based classification metadata | Supported |
| Entry placement validation | Supported |
| Generated entry names | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the trailing index, classification, marker rejection, and index bounds
rejection.
