# Logg ARF resource archives

## Reference and attribution

- GARBro reference: `Legacy/Logg/ArcARF.cs`, class `ArfOpener`
- GARBro tag: `ARF`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Index

The archive has no signature and starts with a 32-bit entry count. Records are walked rather than indexed, and each
one is a payload offset, the unpacked size, a one byte name length and the name:

| Offset | Size | Meaning |
| --- | --- | --- |
| 0x00 | 4 | Payload offset; must point behind the record itself |
| 0x04 | 4 | Unpacked size |
| 0x08 | 1 | Name length |
| 0x09 | length | CP932 name, read up to the recorded length |

The walk has to stay inside the first payload's offset, which the reference uses as the end of the index. A record that
reaches past the archive rejects it.

**Stored sizes are not in the index.** The reference walks the records backwards from the end of the file, so every
entry is stored from its own offset up to the next entry's offset — or to the end of the file for the last one. An entry
whose name is empty is dropped *after* it has delimited the entry behind it, so nameless records act as invisible
delimiters. The reference computes the gap as a signed difference truncated to 32 bits, and the port keeps that wrap for
offsets that do not increase.

An entry is compressed when its stored size differs from its unpacked size. Because the reverse walk defines the stored
size, a stored payload is always exactly the bytes between two offsets.

## Extraction

Stored entries are returned as they are. Compressed entries use the reference's bit codec, an LSB-first bit stream
(`LsbBitStream`): bits fill each byte from its least significant bit upward, and a value is assembled with the first bit
it consumed as its own least significant bit.

| Symbol | Encoding |
| --- | --- |
| Literal | Clear bit, then eight bits of data |
| Match length 2 – 5 | Set bit, then zero, one, two or three set bits before a clear one |
| Match length 6 | Set bit, four set bits, two bits with the value 0 |
| Match length 7 – 10 | Set bit, four set bits, selector 1, a two bit offset from 7 |
| Match length 11 – 26 | Set bit, four set bits, selector 2, a four bit offset from 11 |
| Match length 27 – 1049 | Set bit, four set bits, selector 3, a ten bit offset from 26 |
| Distance below 0x100 | Clear bit, then eight bits |
| Distance 0x100 – 0x4FF | Set bit, clear bit, then ten bits from 0x100 |
| Distance 0x500 and above | Two set bits, then twelve bits from 0x500 |

A match copies `length` bytes from `destination - distance - 1`, byte by byte, so copies may overlap and a distance of
zero repeats the previous byte. The reference writes into a fixed buffer and reads behind it when the distance is too
large; the port reports both cases, and a symbol that is cut off by the end of the stream, as an invalid archive.

## Support

| Capability | Status |
| --- | --- |
| Record walk with offsets, unpacked sizes and names | Supported |
| First-payload bound on the index | Supported |
| Reverse gap pass for stored sizes | Supported |
| Nameless records dropped but kept as delimiters | Supported |
| LSB-first bit codec with the full match ladders | Supported |
| Stored and compressed extraction | Supported |
| Extension-based entry typing | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover stored entries, a repeated-byte match, the middle and widest count and distance ladders, a
nameless delimiter record, a wrapped stored size, an insane count, an offset inside the index, an index that overruns
the first payload, a name that reaches past the archive, and a truncated compressed stream.
