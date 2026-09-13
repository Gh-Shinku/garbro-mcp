# Misc uncategorized BIN resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Misc/ArcBIN.cs`, class `BinOpener`
- GARBro tag: `BIN/?`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The archive opens with an entry count and the offset of the first payload at offset four. That offset has to be exactly
where an index of eight-byte records ends, so the index always occupies `[4, 4 + 8 × count)` and the payloads follow it.

Each index record is a payload offset and a size, and the record's root name comes from the archive itself: entries are
named `<archive>#<index>` with a five-digit index and no extension.

## Entry resolution

The index records are only placement-checked at first. A second pass resolves every entry, and how it does so depends on
the archive's base name:

- **`msg` archives** keep the unpacked size in the index and the stored size in the first payload word, and every entry
  is LZSS compressed. Because these archives can hold entries that overlap their index, this layout is the only one that
  defers the placement check to the payload.
- **Any other archive** stores a position word at payload offset four. When that position exceeds the index size the
  entry is left as the raw index range. Otherwise the word at payload offset eight holds the unpacked size in its low 30
  bits and the two high bits act as a flag:
  - a zero flag means the entry is LZSS compressed, the stored size sits at the position word, and the payload starts
    behind that word;
  - a non-zero flag means the entry is stored, its size is the unpacked size itself and the payload starts at the
    position.

The file signature used for typing is read from behind the payload position — behind one extra byte when that byte's low
nibble is 0x0F. Only the Ogg, RIFF and bitmap special cases of `AutoEntry.DetectFileType` are reproduced: they retype the
entry and rename it to `.ogg`, `.wav` or `.bmp`, while any other signature leaves the entry untouched. The catalog-wide
signature lookup is not reproduced.

## Support

| Capability | Status |
| --- | --- |
| Entry count and first-payload offset check | Supported |
| Eight-byte index records | Supported |
| `<archive>#<index>` naming | Supported |
| `msg` layout with unpacked sizes in the index and stored sizes in payloads | Supported |
| LZSS frame streams | Supported |
| Generic position word with flagged unpacked sizes, stored and packed | Supported |
| Prefix signature probe | Supported |
| Ogg / RIFF / bitmap typing with extension renames | Supported |
| Raw index range fallback | Supported |
| Entry placement validation | Supported |
| Catalog-wide signature type lookup | Not reproduced |
| Archive creation | Unsupported |

Synthetic fixtures cover a message archive, a packed entry typed from its prefix signature, a stored entry typed from its
payload, a position word pointing past the index size, an index that does not end where the first payload starts, and an
archive opened without a source name.
