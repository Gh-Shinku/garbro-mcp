# OMI Script Engine DAT archive

## Reference and attribution

- GARBro reference: `Legacy/Omi/ArcDAT.cs`, classes `DatOpener`, `DecryptedStream` and `DecompressRle`
- GARbro tag: `DAT/OMI`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The reference only opens a file named exactly `scrdat`, and it reads the whole file through its
decrypting stream, so the index becomes plain text once decrypted. The first line is the entry count and
each entry then contributes a name line and a size line, giving two lines per entry. Because the
reference reads lines until a newline byte, a carriage return would stay part of a name; the port keeps
that behavior.

The payload area starts behind the last line the reference consumed, and entries follow each other in
index order, so their offsets come from accumulating the declared sizes rather than from the index, with
each one validated against the file. GARbro marks an entry packed when its name resolves to an image
through its catalog; the port approximates that with an extension list and records it as metadata.

## Cipher

Every byte is rotated right by one bit, then has the low byte of the running key subtracted, after which
the key stretches by `5 * key - 3` modulo 2^32 from its default of 7654321. The stream advances the key
once per byte, so a payload's key state is decided by its offset in the file, which the port reproduces by
advancing the key from the default before decoding a range. `encryptOmiRange` is exported as the exact
inverse so fixtures can build stored files.

## Packed payloads

`DecompressRle` declares an output length in sixteen-bit units and a marker word. Words are copied through
until the marker appears; behind the marker come the word to repeat and a count whose value minus one gives
the number of repeats, which are emitted byte by byte so the two-byte unit alternates as the reference's
overlapping copy does. The reference copies into a buffer of exactly twice the declared length and would
overrun it for a corrupt count, while the port clamps the copy and stops at the end of the stored bytes.

## Support

| Capability | Status |
| --- | --- |
| Exact `scrdat` file name requirement | Supported |
| Whole-file cipher with an offset-derived key state | Supported |
| Text index with a count line and two lines per entry | Supported |
| Sequential payload offsets behind the last line | Supported |
| Entry placement validation | Supported |
| Image classification by extension | Supported as metadata |
| RLE expansion for packed payloads | Supported, with clamping instead of overrun |
| Verbatim extraction for stored payloads | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover a stored payload, an RLE image payload, the file name requirement, and a count
that disagrees with the number of lines.
