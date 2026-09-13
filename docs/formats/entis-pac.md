# Terios PAC resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Entis/ArcPAC.cs`, class `PacOpener`
- GARBro tag: `PAC/TERIOS`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The format only opens files named `.pac`. There is no header: records start at offset zero and each holds a 0x18-byte
name field followed by a 32-bit offset and size. A name field whose first byte is a space ends the list. Every name
byte must be at least 0x20 and a space must terminate the name inside the field, so a name that fills all 0x18 bytes
rejects the archive. Payload offsets are relative to 0x40000 and are checked against the file. The list must be
non-empty and shorter than 0x2000 entries.

## Extraction

`PacOpener.OpenEntry` inspects the first payload byte. When it is zero the byte is dropped and every remaining byte is
exclusive-ored with the bitwise complement of the next byte of a 217-byte cp932 password, cycling through it. Payloads
whose first byte is non-zero are emitted verbatim.

## Support

| Capability | Status |
| --- | --- |
| `.pac` extension gate | Supported |
| Flat name, offset and size records | Supported |
| Space-terminated names with control-byte rejection | Supported |
| Offsets relative to 0x40000 | Supported |
| Entry placement validation | Supported |
| Default password XOR extraction | Supported |
| Verbatim extraction | Supported |
| Entry type inference | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover stored and password-xored entries, password cycling across a payload longer than the password,
and extension, control-byte and unterminated-name rejection.
