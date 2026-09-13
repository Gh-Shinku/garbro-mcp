# ArchAngel engine resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Seraphim/ArcArchAngel.cs`, class `DatOpener`
- GARBro tag: `DAT/ARCH`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The reference only opens the engine's fixed file name, `ARCHPAC.DAT`, and refuses archives larger than 4 GiB. A 16-bit
file count sits at offset zero, followed by a table of that many 32-bit sizes. Section records then follow the size
table as long as each one still fits before the smallest payload offset seen so far, so the walk's own bound shrinks as
offsets are discovered. A record holds a 32-bit base offset and a 16-bit starting file index; an index outside
`[0, fileCount]` or an offset past the end of the file rejects the archive.

Entries are laid out per section in ascending index order. A section walks file indices from its own key until the next
section key, creating an entry for every positive size and advancing the base offset by that size — zero sizes are
skipped without advancing, and the walk may read a size from the section table region when a key equals the file count,
exactly as the reference's unchecked read does. Names are `<section>-<index>`, where the index is zero-padded to six
digits. Every entry must pass the placement check.

Payload types come from the section position: with exactly three sections the reference uses `image`, `script` and an
empty type in order, otherwise everything after the first section is an image. The `script` type doubles as the packing
flag, and it is exposed through the entry metadata alongside the type.

## Extraction

Script payloads are decoded with the ArchAngel LZ decoder that the engine's script formats share: the stream opens with
a 32-bit unpacked size, then control bytes select between a literal run of `control + 1` bytes and a back reference
whose low seven control bits plus five bits of the next byte form the distance and whose remaining five bits form the
length. Copies expand byte by byte and may overlap the output position.

The reference wraps that decode in a catch-all fallback to the stored byte range, so a damaged or non-compressed script
payload is served verbatim; the port mirrors that behaviour, which is also why script sizes are reported as hints rather
than as verified lengths. Payloads of four bytes or fewer, and every non-script payload, are emitted verbatim.

## Support

| Capability | Status |
| --- | --- |
| `ARCHPAC.DAT` file name requirement | Supported |
| 16-bit file count and 32-bit size table | Supported |
| Section records with a shrinking walk bound | Supported |
| Section base offsets with per-file sizes | Supported |
| Default three-section typing | Supported |
| `<section>-<index>` entry names | Supported |
| Script section as the packing flag | Supported |
| ArchAngel LZ decoding with a raw fallback | Supported |
| Verbatim extraction | Supported |
| Entry placement validation | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover three sections with default typing (including one valid and one undecodable script payload),
positional typing for other section counts, skipped zero sizes, the file name requirement, a section index beyond the
file count, an out-of-range payload and a size field that runs past the end of the file.
