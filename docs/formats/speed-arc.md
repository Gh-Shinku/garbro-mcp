# REC engine resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Speed/ArcARC.cs`, class `ArcOpener`
- GARBro tag: `ARC/REC`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The first 32-bit word of a REC archive does double duty: it is the signature GARbro matches, so it is
always `0xFF`, and it is the record length of the name table, which is why it must also stay inside
GARbro's `0x10..0x200` window. The record count follows at 4 and the entry count at 8, and both tables
reserve two extra records in front of themselves, which is how the second header is located:
`0x10 + record_length * (record_count + 2)`.

That second header repeats the pattern, but its record length must be exactly four, since the offset
table holds 32-bit offsets, and its entry count must equal the first one. Behind the second header and
its two padding records come four more bytes and then the payloads.

Every payload is preceded by a size word, and images add twelve more bytes in front of that word, so
the reference advances an entry by four or sixteen bytes depending on its type. That type comes from
GARbro's resource catalog; the port approximates the image classification with an extension list,
which is a documented deviation. The index stores no sizes at all: each entry runs up to the next
entry's offset minus a single size word, which overshoots by twelve bytes whenever the following entry
is an image, and the final entry runs to the end of the file. Extraction itself uses the size word, not
the derived span.

GARbro decodes images with an MSB-first LZ unpacker into BGRA pixels; the archive layer only hands out
the packed payload, and that separate image path is not ported.

## Support

| Capability | Status |
| --- | --- |
| Signature validation (`0xFF` head word) | Supported |
| Name table with a record length of 0x10..0x200 | Supported |
| Two-record table padding | Supported |
| Second header validation (record length four, matching count) | Supported |
| CP932 filenames | Supported |
| Offset table with 32-bit offsets | Supported |
| Derived entry sizes | Supported, including the image overshoot |
| Size-word driven extraction | Supported |
| Image and non-image prefix offsets | Supported via an extension list |
| Image LZ decoding to BGRA | Unsupported |
| Archive creation | Unsupported |

Synthetic fixtures cover the derived sizes, the declared size word, and rejections for a foreign head
word, a mismatched second record length, and a mismatched count.
