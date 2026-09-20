# AZ system resource archive (`ARC/AZ`)

Reference: GARbro `ArcFormats/AZSys/ArcAZSys.cs`, the classes `ArcOpener`, `AsbArchive` and `IndexReader`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License). Implemented as
`packages/formats/src/azsys/arc-archive.ts`.

This is the plaintext sibling of the two encrypted AZSystem archives already ported
(`azsys-isaac-archive`, `azsys-encrypted-archive`). It shares the record layout of
`parseAzIndex` but carries its own index compression, and unlike its siblings it needs no key
material for the default path.

## Head

| offset | field |
| --- | --- |
| 0x00 | `ARC\x1a` (four bytes) |
| 0x04 | `ext_count`, i32, 1..8 |
| 0x08 | `count`, i32, 1..`0xFFFFF` |
| 0x0C | `index_length`, u32, greater than `0x14` and less than the file size |

The packed index starts at `0x30` and is `index_length` bytes long, so entry data begins at
`0x30 + index_length`. `index_length <= 0x14`, a count outside the range, a truncated index or an
index that runs past the end of the file are all rejected.

The first four bytes of the packed index are a checksum that must equal the standard reflected
CRC-32 of the index body, computed from offset `0x14` of the packed index to its end
(`Crc32.Compute(packed, 0x14, length - 0x14)`). Note the `0x14` start, which differs from the
encrypted sibling's `4`.

## Index unpacking

`IndexReader.Unpack`, driven by the four i32 words at `0x04`..`0x10` of the packed index, which
hold the control-block length, the length of each of the two compressed streams, and the
decompressed length:

| offset | field |
| --- | --- |
| 0x04 | `control_length` |
| 0x08 | `compr1_length` |
| 0x0C | `compr2_length` |
| 0x10 | `output_length` |

The control block runs from `0x14`, `compr1` follows it, and `compr2` follows that. The
decompressed index is exactly `count * 0x40` bytes. The control block is read one bit at a time,
most significant bit first, one byte at a time: a set bit takes a 16-bit little-endian word from
`compr1` — `copy_count = (word >> 13) + 3` (so 3..10 bytes) and `offset = (word & 0x1FFF) + 1` —
and copies `copy_count` bytes from `output_position - offset` with the overlapping copy rule
(each byte read is a byte already written, so a run repeats with period `offset`). A clear bit
takes a length byte from `compr2` and copies `byte + 1` literal bytes from the same stream.

The two stream cursors are bounds-checked against each other, and a back reference to a negative
position is rejected instead of throwing a range error.

## Records

The decompressed index is a flat array of `count` records of `0x40` bytes each:

| offset | field |
| --- | --- |
| 0x00 | `offset`, u32, relative to the end of the index |
| 0x04 | `size`, u32 |
| 0x10 | name, CP932, NUL-terminated, at most 48 bytes (`0x30`) |

A record whose name field is empty is skipped. Each entry must lie inside the archive
(`offset + size <= file size`). `contains_scripts` is set when any name ends in `.asb`; the
reference uses it to decide whether to hand the archive to the ASB decryption path.

## ASB entries

`AsbArchive.OpenEntry` is only reachable when the user supplies a key (`AsbOptions`); the
reference's `KnownKeys` dictionary starts empty, so GARbro's default behaviour is to expose the
raw entry bytes, and this port matches that default.

When a key `asb_key` is supplied, an entry that starts with `ASB\x1a` is decrypted as follows.
The key is mixed with the entry's `unpacked` word: `key = (asb_key ^ unpacked)`, then
`key ^= ((key << 12) | key) << 11`, all in 32 bits. The 16-bit word at entry offset `0x10`, minus
`key`, must equal `0xDA78` — this is the zlib header `78 DA` seen through the key, and it is the
reference's marker for a decryptable entry. Each 32-bit word of the encrypted body (which starts
at offset `0x0C` and runs for the declared `size - 0x0C` bytes) then has `key` subtracted. The
first word of the result is a CRC-32 that must match the rest of the body (computed from byte 4
of the body onward), and the remainder is a zlib stream.

Because the body is subtracted word-wise, a body length that is not a multiple of four leaves up
to three trailing bytes untouched — the fixture builder in the tests depends on this, and the
port reproduces it.

## Deviations from the reference

* The reference routes the extraction through its ASB path only when `KnownKeys` holds a key for
  the archive name; this port exposes the plain path for every archive, matching the reference's
  default, and additionally exports `unpackAzAsbEntry(data, entry, asbKey)` for the keyed path.
* `unpackAzAsbEntry` returns `undefined` when no key is given or the entry is not a decryptable
  ASB entry, instead of the reference's `null` propagation through `OpenEntry`.
* Every head, stream-cursor, record and back-reference bound is checked explicitly; the
  reference relies on the surrounding `try`/`catch` for several of them.
* `ext_count` above 1 is recorded but not otherwise used, exactly as in the reference, which
  reads the word and never consults it again.

## Verification

Seven synthetic fixtures in `tests/formats/azsys-arc-archive.test.ts` cover: the overlapping and
non-overlapping copies of `copyOverlapped`; an all-literal index stream; an index stream that
mixes a literal run with four back references (which exercises the wrapping overlapping copy);
the head plus record walk including `contains_scripts` and the entry offsets; the rejection of a
short file, of a bad magic and of a mismatched index CRC-32; the keyed ASB decryption path
round-tripping a deflate-compressed script body; and the end-to-end `detect`/`list`/`extract`
behaviour of the registered format.

What still needs a real archive is listed in the support record: differential output against
GARbro, a keyed ASB entry from a real game, and a head with `ext_count > 1`.
