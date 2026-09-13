# Otemoto TLZ resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Otemoto/ArcTLZ.cs`, class `TlzOpener`
- GARBro tag: `TLZ`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The `TLZ1` header stores an absolute index offset at +4 and an entry count at +0x0c. Each variable-length index
record has unpacked size, stored size, payload offset, a name byte length, then a CP932 name. Entries with different
stored and unpacked sizes use GARBro's default LZSS stream; all other entries are emitted verbatim.

## Support

| Capability | Status |
| --- | --- |
| `TLZ1` signature and variable index records | Supported |
| CP932 names and payload placement validation | Supported |
| Default LZSS extraction | Supported |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |
