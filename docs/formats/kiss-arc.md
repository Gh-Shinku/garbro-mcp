# Kiss ARC archive

## Reference and attribution

- GARBro reference: `ArcFormats/Kiss/ArcARC.cs`, class `ArcOpener`
- GARBro tag: `ARC/KISS`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2016 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

`ARC` archives are detected by the `.arc` extension. A 32-bit entry count sits at offset 0 and
records follow from offset 4: a null-terminated CP932 filename and a 64-bit absolute offset.
Entry sizes are the differences between neighbouring offsets, with the last entry running to the
end of file. GARbro rejects offsets that move backwards.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| 64-bit offsets | Supported |
| Derived entry sizes | Supported |
| Monotonic-offset validation | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the index layout, name decoding, entry placement rejection, and payload
extraction.
