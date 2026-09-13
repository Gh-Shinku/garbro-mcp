# Cadath DAF archive

## Reference and attribution

- GARBro reference: `ArcFormats/Cadath/ArcDAF.cs`, class `DafOpener`
- GARBro reference: `ArcFormats/Cadath/ImageCGF.cs`, class `CgfDecoder`
- GARBro tag: `ARC/DAF`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

A `DAF` archive starts with the ASCII signature `DAF` and a 0x1a byte, followed by a 32-bit record
count at 4. Records start at 8 and are 0x20 bytes: a 32-bit data offset, a 32-bit stored size, and a
0x18-byte CP932 name at +8.

Payloads named `*.snr` are wrapped in a container. GARbro skips a 12-byte header, subtracts a rolling
key whose step count derives from the low nibble of the position, applies the CGF 32-bit XOR stream
(`key = rotl(key, 3); word ^= key; key += 0x3977141B`), and inflates the zlib stream that follows a
four-byte checksum. A failure anywhere in that chain falls back to the raw bytes.

## Support

| Capability | Status |
| --- | --- |
| Signature detection | Supported |
| Flat 0x20-byte record index | Supported |
| Rolling-key SNR decryption | Supported |
| CGF 32-bit XOR stream | Supported |
| SNR zlib inflation | Supported |
| Raw fallback for invalid SNR payloads | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Unpacked sizes are not stored anywhere in the archive, so the port unwraps `.snr` payloads while
listing to learn their final size, which keeps extraction verifiable. Decoded payloads stay in memory
for the lifetime of the archive handle.

Synthetic fixtures cover the record index, the full SNR pipeline, the raw fallback path, and entry
placement rejection.
