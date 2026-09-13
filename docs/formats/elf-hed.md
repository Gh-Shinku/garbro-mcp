# elf AV King resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/elf/ArcHED.cs`, class `PakOpener`
- GARbro tag: `BIN/HED`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

This is a three-file format. The archive itself is a plain payload file with a `bin` extension; its sizes and
names live elsewhere, so neither can be read from it alone.

A sibling `.pak` file holds the index: the four bytes `hed` and a null, then an entry count, then one record per
entry. Graphic indexes use eight-byte records of an offset and a size, while voice indexes use 0x18-byte records
whose first eight bytes hold the same pair — the reference reads only those first bytes and ignores the rest, and
the port mirrors that. Every offset is validated against the *archive's* length, since that is the file they
address, and payloads are stored verbatim.

Names come from a second companion, `avking.map`, which GARbro looks for by walking upwards from the archive's
directory. It is a sequence of blocks, each opened by a header line of the form `//<TYPE> FILES = <count>` and
followed by exactly that many name lines. `BG` and `CHR` blocks fill the graphic list and `VOICE` blocks the voice
one, while any other type still has its names *consumed* and discarded — so an unknown block does not
desynchronise the parse, and every line must be either a header or a consumed name, which makes a stray blank
line fatal. Names have trailing nulls trimmed.

Only archives named `cg` or `voice` are handled, that name chooses which map section applies, and its length must
equal the index's count.

## Support

| Capability | Status |
| --- | --- |
| `bin` extension requirement and `cg`/`voice` name gate | Supported |
| `hed` magic and count validation | Supported |
| Graphic and voice record widths | Supported |
| Name list search upwards from the archive directory | Supported |
| Block parsing with unknown types consumed | Supported |
| Name trimming and count agreement | Supported |
| Placement validation against the payload file | Supported |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a graphic archive, a voice archive, a count that disagrees with the name list, an index
without the magic, an archive whose name has no map section, and two map-parsing cases including an unknown block.
