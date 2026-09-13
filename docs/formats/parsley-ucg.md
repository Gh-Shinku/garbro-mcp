# Software House Parsley UCG archive

## Reference and attribution

- GARBro reference: `ArcFormats/Software House Parsley/ArcUCG.cs`, class `UcgOpener`
- GARBro tag: `UCG`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The first byte of the file is 0x64 and a 32-bit record count follows at 4. Records are 0x18 bytes
with a 0x14-byte CP932 name and a data offset behind it, which must start behind the index. GARbro
rejects blank names and offsets outside the file.

Records carry no sizes: GARbro derives each size from the next offset and lets the last entry run to
the end of the file. Payloads are extracted raw, and archives whose name contains `CG` are flagged as
image containers in the entry metadata.

## Support

| Capability | Status |
| --- | --- |
| Signature byte detection | Supported |
| 0x18-byte records | Supported |
| First-offset validation | Supported |
| Derived entry sizes | Supported |
| Image flag for `CG` archives | Supported |
| Blank name rejection | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Image decoding | Not applicable |
| Archive creation | Unsupported |

Synthetic fixtures cover the record walk, derived sizes, blank name rejection, index bounds
rejection, and signature rejection.
