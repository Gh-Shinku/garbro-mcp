# CVNS engine CPZ1 resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Cmvs/ArcCPZ1.cs`, class `Cpz1Opener`
- GARBro reference: `ArcFormats/Cmvs/ArcCPZ.cs`, class `CpzOpener` (LZSS variant)
- GARBro tag: `CPZ1`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `CPZ1` archive stores a record count at 4 and the index size at 8. The index lives at 0x10 and is
obfuscated with GARbro's fixed 64-byte key: every byte is XORed with the repeating key and then has
0x6c subtracted. Records are variable length and start with their own size, followed by the stored
size at +4, the data offset at +8, and the name behind +0x18; data offsets are relative to the end of
the index.

Payloads use the same obfuscation. Those that start with `PSS0` are additionally LZSS-packed: a
0x800-byte frame with an initial position of 0x7df, eight control flags per byte and an initial
control value that forces a fresh control byte, and the unpacked size stored at +0x28 behind a
0x30-byte header that is copied into the output verbatim. Because that size is declared, the port
exposes the final size while listing.

## Support

| Capability | Status |
| --- | --- |
| Signature and extension detection | Supported |
| Fixed-key index decryption | Supported |
| Variable-length records | Supported |
| Relative data offsets | Supported |
| Payload decryption | Supported |
| `PSS0` LZSS unpacking | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the encrypted index, payload decryption, the LZSS variant with its declared
size, signature rejection, and extension rejection.
