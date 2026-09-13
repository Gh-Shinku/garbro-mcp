# X[iks] IKS archive

## Reference and attribution

- GARBro reference: `ArcFormats/ArcIKS.cs`, class `IksOpener`
- GARBro tag: `IKS`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `IKS` archive starts with the `NPSR` signature and a 32-bit record count at 4, which must be
positive and at most 0xfffff. The index starts at 0x10 with 0x28-byte records: a name length byte, a
CP932 name, the stored size at +0x1c, and the data offset at +0x20. Offsets must start behind the
index.

GARbro clamps the stored name length to 0x17 bytes. Payloads are XORed with the single key byte that
ships in GARbro's known-key table, 0x66.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| 0x28-byte index records | Supported |
| Name length clamping | Supported |
| Payload XOR decryption | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Per-game key configuration | Not applicable |
| Archive creation | Unsupported |

GARbro's known-key table contains one entry that is applied unconditionally, so no per-game key
selection exists in the reference implementation either. Names are truncated at a NUL terminator,
which differs from GARbro's fixed-width decode only for padded name fields.

Synthetic fixtures cover the record layout, CP932 names, XOR payloads, the name clamp, and entry
placement rejection.
