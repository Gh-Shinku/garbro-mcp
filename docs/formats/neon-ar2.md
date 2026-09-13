# Neon resource archive

## Reference and attribution

- GARBro reference: `Legacy/Neon/ArcAR2.cs`, class `Ar2Opener`
- GARBro tag: `AR2/NEON`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The whole archive is XORed with 0x55. GARbro validates the leading record header before decrypting
anything: the 32-bit word at 8 must equal the repeated key `0x55555555`, the words at 0 and 4 must be
equal, and the word at 0x0c XORed with the repeated key must not exceed 0x100.

Records follow each other directly: a 0x10-byte header with the payload size and the name length at
+0x0c, the CP932 name, and the payload. A record whose size and name length are both zero is skipped.
Payloads are XORed with the archive key on extraction.

## Support

| Capability | Status |
| --- | --- |
| Header validation without a signature | Supported |
| Whole-archive XOR decryption | Supported |
| Sequential record walk | Supported |
| Zero-length record skipping | Supported |
| XOR-decrypted payloads | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the record walk, key validation, name length rejection, and payload
extraction.
