# Masys MGD resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Masys/ArcMGD.cs`, class `MgdOpener`
- GARBro tag: `MGD`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive starts with the `MGD` signature, which shares its 32-bit word with a 16-bit flag at
offset 3. The record count sits at 0x20 and records begin at 0x22: one unused byte, a name length
byte, the name, the stored size, and the data offset. A zero name length is rejected.

A flag value of 100 marks encrypted names: every name byte is XORed with the repeating key
`Powerd by Masys`, applied with a period of 0x0f bytes. GARbro derives entry types from payload
signatures; the port keeps the stored names.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Length-prefixed name records | Supported |
| Flagged name decryption | Supported |
| Zero name length rejection | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Entry type inference | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover the record walk, encrypted names, zero name length rejection, and signature
rejection.
