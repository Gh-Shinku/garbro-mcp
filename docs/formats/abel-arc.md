# ADVEngine ARC resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Abel/ArcARC.cs`, class `ArcOpener`
- GARBro tag: `ARC/ADVENGINE`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The `arc\0` header holds the record count at 0x08, a payload base offset at 0x0C, the packed size of the index at 0x10
and that index's uncompressed size at 0x14. The reference requires the base offset to be past the 0x18-byte header and
inside the file, the packed size to stay within the file, and the uncompressed size to be exactly `count * 0x26`; the
index itself is a default LZSS stream at 0x18.

Records are 0x26 bytes: a 30-byte CP932 name followed by the payload offset and size. Offsets are relative to the base
offset, which is where the payload region starts, and every entry must pass the reference's placement check. Names with
an `.acd` extension, compared case-insensitively, are typed as scripts.

## Extraction

Payloads are plain byte ranges unless a name and payload match one of the reference's containers:

- `.cmp` entries larger than 12 bytes whose payload starts with `CMP\0` keep a sub-range offset at +8. When that offset
  is inside the entry and the byte it points at is zero, the word at +5 is the packed size of an LZSS stream at +0x11,
  and the stream is used only when that size equals the remaining entry size (computed with the reference's 32-bit
  wrap-around). Any other layout falls back to the raw sub-range from the offset.
- `.acd` entries larger than 8 bytes whose payload starts with `ACD\0` have every byte behind the first eight XORed
  with 0xFF.

## Support

| Capability | Status |
| --- | --- |
| `arc\0` signature | Supported |
| Count, base offset and index size validation | Supported |
| LZSS-compressed index at 0x18 | Supported |
| 0x26 records with 30-byte CP932 names | Supported |
| Record-relative payload offsets | Supported |
| `CMP` container LZSS extraction | Supported |
| `CMP` raw fallback | Supported |
| `ACD` payload XOR | Supported |
| Script typing for `.acd` names | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover index parsing and plain extraction, both `CMP` branches, the `ACD` XOR cipher and its script
typing, a mismatched index size, a base offset inside the header and an out-of-range entry.
