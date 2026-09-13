# GLib engine resource archives

## Reference and attribution

- GARBro reference: `ArcFormats/GLib/ArcG.cs`, class `GOpener`
- GARBro tag: `G/GML`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- Extensions: `g`, `xp`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Header and index

The archive starts with the eight byte marker `GML_ARC\0`, followed by three words:

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x08 | 4 | Data offset; payload offsets are relative to it |
| 0x0C | 4 | Unpacked index size |
| 0x10 | 4 | Packed index size |

The packed index starts at 0x14. Every byte is exclusive-ored with 0xFF, and the result is run through GARbro's default
LZSS variant: set control bits mark literals, and a match is a sixteen bit value whose high nibble holds bits 8 to 11 of
the ring buffer distance while its low nibble holds the length beyond three. The port uses the shared LZSS decoder with
its default ring buffer, fill byte and frame position.

The unpacked index is a 256 byte substitution table, a 32-bit entry count, and one record per entry:

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 4 | Name length |
| 0x04 | length | CP932 name, read up to the recorded length |
| — | 4 | Payload offset, relative to the data offset |
| — | 4 | Stored size |
| — | 4 | The payload's first four bytes |

Every record is placement-checked against the archive size. An index that does not hold a full table and entry count, a
packed range that reaches past the archive, and an index record that overruns it all reject the file. The reference
allocates the declared unpacked index size, so the port bounds it as well.

## Extraction

A stored payload is returned with a per-byte substitution applied **from its fifth byte onwards**: each remaining byte
is replaced by the table's entry for it. The first four bytes are then copied back out of the index, so they survive the
substitution untouched. The reference copies all four bytes unconditionally, which means a payload shorter than four
bytes is an error rather than a partially restored one; the port reports that as an extraction failure.

## Support

| Capability | Status |
| --- | --- |
| `GML_ARC` marker and the packed index header | Supported |
| 0xFF exclusive-or and LZSS index decompression | Supported |
| Substitution table, entry count and records | Supported |
| Index-relative payload offsets and stored sizes | Supported |
| Per-entry four byte headers | Supported |
| Payload substitution and header restoration | Supported |
| Placement validation and index bounds | Supported |
| Extension-based entry typing | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover a two-entry archive with payload substitution, a name padded to its recorded length, a payload
shorter than its entry header, a foreign signature, a file that is not marked `ARC`, an insane count, an index too small
for its table, packed data past the archive, a name length that overruns the index, and an entry outside the archive.
