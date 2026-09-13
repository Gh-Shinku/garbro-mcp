# West Gate USF archive

## Reference and attribution

- GARBro reference: `Legacy/WestGate/ArcUSF.cs (index reader in Legacy/WestGate/ArcUCA.cs)`, class `UsfOpener`
- GARBro tag: `USF`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`USF` archives are detected by the `.alh`, `.usf`, `.udc`, `.uwb` and `.arc` extensions and
have no separate header: the record table starts at offset 0. A 32-bit value at 0x0c must be
16-byte aligned and smaller than the file; the entry count is `value / 0x10` and the same value
is the first data offset.

Each 0x10-byte record holds a 12-byte CP932 name whose tail at +0x0c is the next data offset.
GARbro rejects empty, duplicate, or rooted/invalid-character names, and requires monotonic
offsets; the last entry runs to the end of file.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Record-tail offset chain | Supported |
| Name validation and duplicate rejection | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
