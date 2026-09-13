# NekoSDK NEKOPACK4 resource archives

## Reference and attribution

- GARBro reference: `ArcFormats/NekoSDK/ArcPAK.cs`, class `PakOpener`
- GARBro tag: `NEKOPACK/4`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Header and index

The archive starts with the marker `NEKOPACK4` and a version byte at 0x09. Two versions are known, and they differ in
where the index starts and what the word at 0x0A means:

| Version | Index start | End of index | Word at 0x0A |
| --- | --- | --- | --- |
| `A` | 0x0E | 0x0E + word | Index size |
| `S` | 0x0A | 0x0A + word + 12 | First name length |

In the `S` layout the word is the length of the first name, and the index begins right at it, so the reference reads that
word twice — once as the index length and once as the first record's name length. The port keeps the same arithmetic.

Index records are a name length, the name, and an exclusive-ored payload offset and size:

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 4 | Name length; zero ends the index |
| 0x04 | length | Name |
| — | 4 | Payload offset, exclusive-ored with the key |
| — | 4 | Stored size, exclusive-ored with the key |

The key is the sum of the name's bytes read as **signed** values, truncated to 32 bits. Names longer than the reference's
0x100-byte buffer reject the archive, as does an entry that falls outside it. Paths are normalized.

## Extraction

Every payload is a zlib stream with two extra fields:

1. its first four bytes are stored encrypted — each byte is exclusive-ored with a key byte that starts at
   `stored size / 8 + 0x22` and is shifted left three bits per byte;
2. its last four bytes hold the unpacked size and are *not* part of the stream.

The opener decrypts the header, appends the middle of the payload — everything between the header and that last word —
and inflates the result. An entry of four bytes or fewer is nothing but its decrypted header. Entries smaller than eight
bytes have no unpacked size to read, so their output size is reported as unknown.

The port reads the trailing unpacked size while listing, so a listing and an extraction agree on the entry size. The
reference also clears the type of `.alp` names; entry typing comes from the extension catalog, which the port does not
reproduce, so no type is recorded either way.

## Support

| Capability | Status |
| --- | --- |
| `NEKOPACK4` marker with the `A` and `S` layouts | Supported |
| Index records with names and XOR-encoded offsets and sizes | Supported |
| Index key from signed name bytes | Supported |
| Unpacked size trailer for entries of eight bytes or more | Supported |
| Four-byte header decryption and the middle payload range | Supported |
| zlib decompression | Supported |
| Path normalization and placement validation | Supported |
| Extension-based entry typing | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover both layouts, a multi-entry archive, a CP932 name whose signed byte sum is negative, a foreign
marker, an unknown version, an index past the archive, an index without entries, an over-long name and an out-of-range
payload.
