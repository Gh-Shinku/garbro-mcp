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

* The image decoders (`MmeImageDecoder`, `MmeMaskDecoder`), archive creation and the `ImageFormat`
  metadata of the reference are out of scope; payloads are extracted as described above.
* The LZ output is always allocated at `unpackedSize`, so a truncated stream yields that length with
  the remaining bytes left clear, matching the reference's `new byte[UnpackedSize]`.
