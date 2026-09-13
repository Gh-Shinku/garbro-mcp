# Black Butterfly DAT/PITA resource archives

## Reference and attribution

- GARBro reference: `Legacy/BlackButterfly/ArcDAT.cs`, class `DatOpener`
- GARBro tag: `DAT/PITA`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Index

The archive starts with the `PITA` marker and an entry count at 0x04. The offset table begins at 0x10 and holds **one
offset more than the entry count**:

| Offset | Meaning |
| --- | --- |
| 0x10 + 4i | Start of entry *i* |
| 0x10 + 4(i + 1) | End of entry *i*, and the start of the next one |

An entry therefore stores exactly the bytes between its own table offset and the next one. Every entry is
placement-checked, and a stored range shorter than the payload's four byte header rejects the archive.

Names are generated from the entry index as five zero-padded digits with a `.bmp` extension, and every entry is
recorded with image type metadata.

## Payloads

Each payload starts with its unpacked size as a 32-bit word, and the rest is a byte oriented command stream. The port
reads that size word while listing so that a listing and an extraction agree on the entry size, and reports the stored
size separately.

| Control | Meaning |
| --- | --- |
| 0x00 – 0x7E | Match: length `(control >> 2) + 2` from the ten bit distance `((control & 3) << 8 \| next) ^ 0x3FF`, plus one |
| 0x7F | End of stream when the next byte is 0xFF, otherwise a match |
| 0x80 – 0x9F | `(control & 0x1F) + 1` literal bytes |
| 0xA0 – 0xBF | `(control & 0x1F) + 1` pairs of a zero followed by one literal byte |
| 0xC0 – 0xDF | `(control & 0x1F) + 2` copies of a byte read from the stream |
| 0xE0 – 0xFE | `(control & 0x1F) + 1` zeroes |
| 0xFF | `next + 32` zeroes |

Matches copy from `destination - distance` byte by byte, so they may overlap. The reference copies into a fixed output
buffer, so a distance that reaches behind the buffer, a stream that ends mid-command, and a command that would write
past the declared output size are all reported as invalid archives by the port rather than silently truncated.

## Support

| Capability | Status |
| --- | --- |
| `PITA` marker, entry count and offset table | Supported |
| Stored sizes from the offset gaps | Supported |
| Generated names and image metadata | Supported |
| Unpacked size probed from the payload header | Supported |
| All six command forms of the byte codec | Supported |
| Output bounds checks and truncation errors | Supported |
| Extension-based entry typing | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover literal and match commands, zero runs, repeated byte runs, interleaved zero and literal pairs,
an explicit long zero run, generated names and image metadata, the separate stored and unpacked sizes, a foreign
signature, an insane count, an offset table past the archive, non-increasing offsets, an output overflow, and a
truncated command stream.
