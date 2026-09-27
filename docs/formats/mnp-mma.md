# MNP engine MMA resource archive

Reference: `GARbro/ArcFormats/Mnp/ArcMMA.cs`, class `MmaOpener` (listing, name list and payload
unpacking; `MmeImageDecoder`/`MmeMaskDecoder` are out of scope)
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/mnp/mma.ts` (`mmaDescriptor`, `mmaFormat`, id `mnp-mma`).

## Header and index

| Offset | Size | Meaning |
|--------|------|---------|
| `0x00` | 4 | `ARC!` |
| `0x04` | 4 | index offset (`u32`) |
| `0x0C` | 4 | version, must be 1 |
| `0x10` | 4 | entry count (`i32`) |
| index offset | 0x14 × count | records |

Detection is the `ARC!` signature (the registry gates on those four bytes) plus version one, a sane
entry count, and an index offset that leaves room for the whole record table. Every record is
`[u32 offset][u32 unpacked size][u32 size][u32 header size][u32 flags]`, names are generated as
`<base>#<index:05>`, and each entry passes `checkPlacement`. The upper flag bits type an entry:
`flags & 0x38` of 8, `0x10`, `0x18` or `0x38` means `image` and `flags == 0x2D` means `audio`.

## Name list

When the first record has `flags == 0x2F` its payload is unpacked and decoded as cp932 line by line
(CR, LF or CRLF); line *i* renames entry *i* through the file name part only, and the list stops at
the end of the text, so entries beyond the last line keep their generated names.

## Payload storage

The low flags (`flags & 6`) select the branch `OpenEntry` takes:

* `6` with `headerSize == 0` — an LZ stream is unpacked into exactly `unpackedSize` bytes.
* `4` — the first `headerSize` bytes are skipped, the next `unpackedSize` bytes are copied and then
  masked: every byte is XORed with the repeating 32 byte key and rotated right by three.
* anything else — the stored bytes are returned as they are.

The key is the reference's `DefaultKey`:

```text
77 2C 6F 7A 71 4F 25 74 6C 28 7A 81 4C 31 81 5B
77 81 4D 79 29 69 45 6B 79 7A 68 2D 69 66 29 39
```

### LZ stream

The first byte is a marker: `0xC0` starts a plain LZ stream, `0x00` means the payload is stored
verbatim (`unpackedSize` bytes behind the marker), and any other value that XORs with the first key
byte to `0xC0` means the whole stream — marker included — is masked with the repeating key before
decoding (the reference re-wraps the stream in a `ByteStringEncryptedStream`).

The stream is read most significant bit first. A control byte is read whenever the bit mask runs
out, and **the next control byte follows the data of the previous eight items**, not the other
control bytes. A set bit reads a 16 bit big-endian word: the count is `(word & 0x1F) + 3` and the
distance is `(word >> 5) + 1`, copied byte by byte so overlaps work. A clear bit is a literal whose
stored byte is rotated **left** by five when read, so the encoder stores it rotated right.

## Deviations

* `MmaOpener.OpenImage` reads the places of an entry whose `flags & 0x38` is eight, `0x10` or `0x18`: the head of
  the picture stands at the front of the entry — its width and height for a picture of a covering place, and its
  width, height, count of places of a colour and count of places of a row for every other picture — and the places
  themselves stand behind the head the entry declares of itself, which is therefore never shorter than the head of
  the picture. The walk of the places stands of the same flags of storage as `OpenEntry`, and a row of the file
  stands of the count of a row the head names, of which a bitmap holds the places of the picture alone. A picture of
  a covering place stands of eight places of a colour, one to a pixel, and hands over as a grey bitmap; every other
  picture stands of twenty four or of thirty two places of a colour, and the fourth place of a pixel of a picture of
  thirty two places of a colour stands of the whole of itself, since the reference reads such a picture as `Bgr32` of
  no covering place. `0x38` stands of no walk of its own in the reference either, so such an entry stands handed over
  as the places of the file.
* A picture of a count of places of a colour the engine knows not stands turned away, where the reference would hand
  it over as a picture of thirty two places of a colour over a row of its own count.
* Archive creation and the `ImageFormat` metadata of the reference are out of scope; every other payload is
  extracted as described above.
* The LZ output is always allocated at `unpackedSize`, so a truncated stream yields that length with
  the remaining bytes left clear, matching the reference's `new byte[UnpackedSize]`.
