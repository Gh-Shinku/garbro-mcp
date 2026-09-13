# Propeller MPK archive

## Reference and attribution

- GARBro reference: `ArcFormats/Propeller/ArcMPK.cs`, class `MpkOpener`
- GARBro tag: `MPK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

An `MPK` archive stores the index offset at 0 and a 32-bit record count at 4, followed by an index
of 0x28-byte records: a 0x20-byte CP932 name, a 32-bit data offset at +0x20, and a 32-bit size at
+0x24. The last byte of the first name field doubles as an XOR key for the whole index, so the key
must be read before the index is decrypted. A leading backslash in a name is skipped.

Entries are stored verbatim except for `*.msc` scripts: when the stored payload starts with 0x88 the
whole entry is XORed with 0x88, which restores scripts whose plaintext begins with a zero byte.

## Support

| Capability | Status |
| --- | --- |
| Structural detection | Supported |
| XOR-encrypted index | Supported |
| Leading-backslash name handling | Supported |
| `*.msc` payload de-obfuscation | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover index decryption, plain and obfuscated script payloads, and index size
rejection.
