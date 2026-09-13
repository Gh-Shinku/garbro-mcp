# Yatagarasu PKG archive

## Reference and attribution

- GARBro reference: `ArcFormats/Yatagarasu/ArcPKG.cs`, class `PkgOpener`
- GARBro reference: `ArcFormats/SimpleEncryption.cs`, class `ByteStringEncryptedStream`
- GARBro tag: `PKG`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `PKG` archive is registered for the `pkg` extension. Its key is stored in the clear inside the
padding of the first two name fields: the 32-bit values at 0x84 and 0x10c must match, and their
little-endian bytes form the four-byte repeating XOR key.

The record count sits at 4 as an XOR-encrypted 32-bit value. The index starts at 8 with 0x80-byte
CP932 name fields followed by a 32-bit size and a 32-bit data offset. Index and payload bytes are
XOR-decrypted with the repeating key. `ByteStringEncryptedStream` derives its key position from the
stream position: the index stream starts at file offset 0, while each payload stream restarts at key
position 0.

## Support

| Capability | Status |
| --- | --- |
| Extension-based detection | Supported |
| Duplicated key field validation | Supported |
| XOR-decrypted record count | Supported |
| XOR-decrypted index | Supported |
| XOR-decrypted payloads | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Payload decryption restarts the repeating key at the beginning of each entry, which matches the
reference implementation. Archives whose payload offsets are multiples of the four-byte key also
align with the file-wide key stream.

Synthetic fixtures cover key recovery, index and payload decryption, extension rejection, and key
field mismatch rejection.
