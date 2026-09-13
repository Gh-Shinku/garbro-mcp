# Valkyrie Complex PAK archive

## Reference and attribution

- GARBro reference: `ArcFormats/Circus/ArcValkyrieComplex.cs`, classes `VcPakOpener`, `VcPakFile` and
  `ReverseBitStream`
- GARbro tag: `PAK/VC`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The head spells the format's own name in shift-jis, and its last two characters pick the edition: a trial build
or a retail one. Each edition selects a key byte, and that byte is replicated across all four bytes of a word to
mask the entry count and index size at 0x18 and 0x1C, then applied to every byte of the index itself.

Records begin four bytes into the decoded index and are sixteen bytes wide, holding a name length, the data
offset and the size, while the names trail the whole record list separated by null bytes. The names begin one
record stride per entry in, which places them right behind the last record's fields. Entries whose names end in
`.cps` are classified as images.

## Extraction

Every payload is first exclusive-ored with a second key byte, again chosen by the edition. A `.cs` script then has
every byte decremented, and a `.cps` image goes through `UnpackCps`, whose output length is a word in the first
four bytes with a fixed mask applied and whose top nibble selects the layout:

- zero copies the payload behind its four-byte header;
- one reads a four-bit count, then one bit that chooses between that many bytes plus one written literally and a
  single byte repeated that many times, so a zero count emits nothing at all;
- two seeds the last output byte from the payload's byte 36 and decodes from byte 38 in two-byte steps, where one
  bit chooses two literal bytes — written in reverse order — and a run of zero bits picks one of fifteen
  two-byte pairs from a table at offset 4;
- three copies up to 128 bytes whole from the header, and beyond that keeps its first 128 bytes literal and
  decodes the rest with a seven-bit distance plus one and a four-bit count plus two.

The bit stream is read least-significant-bit first, which is the opposite of the reader most other ports in this
project use, so the codec carries its own. A nibble above three leaves the payload untouched, header included, and
a payload of at least 0x308 bytes has two position pairs swapped before decoding.

## Support

| Capability | Status |
| --- | --- |
| Trial and retail signatures with their key bytes | Supported |
| Masked count and index size, keyed index bytes | Supported |
| Records with names behind them | Supported |
| `.cs` decrement | Supported |
| `.cps` layouts zero to three | Supported |
| Unknown `.cps` layout passthrough | Supported |
| Least-significant-bit stream reader | Supported |
| Entry placement validation | Supported |
| Inexact size marking for expanded entries | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a script and a stored image, each of the three packed layouts, an unknown layout, a
foreign signature, and the extension requirement. Four fixture bugs were needed to get there, all in the test
builder rather than the port: a record offset that needed the index's leading word added, a name block that had to
start one stride per entry in, an expectation that used the expanded size where the archive reports the stored
span, and a version two body too short for its bit stream.
