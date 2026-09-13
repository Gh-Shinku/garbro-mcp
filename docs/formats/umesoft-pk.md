# U-Me Soft PK resources archive

## Reference and attribution

- GARBro reference: `ArcFormats/UMeSoft/ArcPK.cs`, class `PkOpener`
- GARBro tag: `PK`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

There is no signature; the reference registers `pk`, `gpk`, `tpk`, `wpk`, `mpk`, `pk0` and `pka`–`pkf` extensions but
detects the layout structurally. The last four bytes of the file hold the index size, and the index sits directly in
front of that trailer — payloads precede it.

Records are read until a zero length byte terminates the list. A record consists of a one-byte name length, the CP932
name, six bytes the reference skips, and the stored size and payload offset. The whole record must fit inside the index,
and the reference also rejects names whose decoded length is implausibly short for their field, which rules out records
padded with NUL bytes.

Payload placement is checked against the position of the record's own size field rather than the end of the file, which
is how the reference enforces that payloads live before the index. An index that yields no records at all is rejected.

## Extraction

Only entries with a `scr` or `tbl` extension are compressed, and only when the 32-bit word in front of the payload is
positive: that word is the unpacked size, and the stored extent shrinks by those four bytes. The stream is decoded with
the reference's private decoder — control bits are consumed least-significant first from a byte that is refilled with a
fresh control value, a clear bit emits one literal, and a set bit reads two bytes whose high nibble pair is the distance
and whose low nibble plus three is the length. A distance of zero ends the stream early, overlapping copies expand byte
by byte, and a match that runs past the declared output size raises an invalid-archive error. Decoded bytes are then
inverted with 0x42. Every other payload — including scripts whose size word is not positive — is emitted as a plain byte
range.

## Support

| Capability | Status |
| --- | --- |
| Trailing index size word | Supported |
| Record walk with zero-length terminator | Supported |
| One-byte name length with CP932 names | Supported |
| Payload placement against the size field | Supported |
| `scr`/`tbl` size-prefixed LZ stream | Supported |
| XOR-0x42 deobfuscation | Supported |
| Verbatim extraction | Supported |
| Empty archive rejection | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the decoder (a literal and an overlapped match), stored entries, a compressed script, a script
with a non-positive size word, an unusable index size, an index larger than the file and a payload that does not end
before its record.
