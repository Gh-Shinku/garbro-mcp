# CVNS CPZ2 resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Cmvs/ArcCPZ2.cs`, class `Cpz2Opener`
- GARBro tag: `CPZ2`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior. The LZSS unpacker shared with the CPZ1
opener lives in `ArcFormats/Cmvs/ArcCPZ.cs` and is ported once in `packages/formats/src/cmvs/cpz.ts`.

## Structure

The `CPZ2` signature is followed by three masked words: the record count at 0x04 (masked with `0xE47C59F3`), the
encrypted index size at 0x08 (masked with `0x3F71DE2A`) and the index key at 0x10 (masked with `0x40DE832C`). The index
starts at 0x14 and every payload offset is relative to the end of the index.

The index is encrypted with the same transform as the payloads, and it holds variable-length records: the record's own
leading word is its size, the stored size follows at +4, the payload offset at +8, the per-entry key at +0x14 and the
name behind +0x18. The reference rejects non-positive record sizes and records that do not fit inside the index, reads
each name up to the first zero byte and requires every entry to pass its placement check. Files are only considered when
they carry the `.cpz` extension.

## Payload transform

A rotation amount is derived by XORing the key's eight nibbles into a base of five and adding eight. Whole words are
XORed with a 16-entry table value plus the key, reduced by `0x15C3E7` and rotated right; up to three trailing bytes
continue the same table walk, each XORed with the low bits of that sum and incremented by `0x37`. The port implements
both stages with explicit 32-bit wrap-around.

## Extraction

Every payload is decrypted with its own key. When the decrypted bytes start with `PSS0`, the shared CPZ LZSS unpacker is
applied: a 0x800-byte frame initialised at 0x7DF, control bytes holding eight flags, and a declared unpacked size at
+0x28. Those entries are listed with the final size and marked as compressed. Everything else is emitted after
decryption.

## Support

| Capability | Status |
| --- | --- |
| `CPZ2` signature and `.cpz` extension | Supported |
| Masked count, index size and index key | Supported |
| Table-based index decryption | Supported |
| Per-entry payload keys | Supported |
| Variable-length records with self size | Supported |
| Index-relative payload offsets | Supported |
| `PSS0` LZSS unpacking | Supported |
| Entry placement validation | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover the payload transform round trip, an encrypted index with plain and `PSS0` entries, the
extension requirement, an index that runs past the file, a non-positive record size and an out-of-range entry.
