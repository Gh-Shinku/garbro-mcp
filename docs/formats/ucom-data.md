# For/Ucom scripts archive

## Reference and attribution

- GARBro reference: `ArcFormats/Ucom/ArcDATA.cs`, class `DataOpener`
- GARBro tag: `DATA/UCOM`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARBro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The payload file must be named `data02` and start with `PF`. Its companion `data01` holds the index:
an `IF` signature, a 16-bit record count, and 0x18-byte records with a 0x10-byte name, the data offset
at +0x10, and the size at +0x14. GARbro requires the index to fit inside the companion file.

Payloads use a strided obfuscation: every fifth byte is stored in the clear while the rest are XORed
with 0x45, which the port reverses on extraction.

## Support

| Capability | Status |
| --- | --- |
| File name and signature detection | Supported |
| Companion `data01` index | Supported |
| Index bounds validation | Supported |
| Strided XOR payload decryption | Supported |
| Entry placement validation | Supported |
| CP932 filenames | Supported |
| Entry listing and extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the companion index, strided decryption, file name rejection, and payload
extraction.
