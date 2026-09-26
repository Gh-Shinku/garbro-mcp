# NGS engine resource archive (NPF)

## Reference and attribution

- GARBro reference: `ArcFormats/Nonono/ArcNPF.cs`, classes `NpfOpener`, `RandomGenerator1`, `RandomGenerator2`
- GARBro tag: `NPF`
- GARBro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The archive opens with the word `PACK` followed by the version words `4` and `1`. Directory, names and payloads
are exclusive-ored with the low byte of a pseudo random generator, and the writer seeded every entry with its
own value, so the reader has to recover the seeds from the directory.

## Layout

```
[0x00] 'PACK', u32 4, u32 1
[0x0C] 0x14 directory header, encrypted
[0x20] u32 count records of 0x14 bytes, encrypted
[0x20 + 0x14 * count] names, each encrypted with its entry seed
[payloads]
```

Because no offset field leads to the record area, the record count has to be read before anything else: the
directory header is decrypted first, must open with `FAT `, and carries the entry count at offset eight. The
records are then decrypted as one block, and every record holds a payload offset, an entry seed, a name length
and a payload size. A name is between one and 0x100 bytes long and is read from the name area, decrypted with
its own seed and decoded as CP932. Names are hierarchical, so backslashes are turned into slashes.

## Generators

The reference tries two generators in turn and keeps the one that parses the directory; extraction repeats the
keystream from the same generator, seeded with the entry's own seed. Both generators work on signed 32-bit
arithmetic.

- `RandomGenerator1`: seeded with `0x46415420`, and `SRand` discards 32 values before use. Each step xores the
  state with `0x65AC9365` and then with `(((state >> 1) ^ state) >> 3) ^ (((state << 1) ^ state) << 3)`.
- `RandomGenerator2`: `SRand` keeps the seed and derives `seed2 = ((seed >> 12) ^ (seed << 18)) - 0x579E2B8D`.
  Each step computes `n = seed2 + ((seed1 >> 10) ^ (seed1 << 14))` and then `seed2 = n - 0x15633649 +
  ((seed2 >> 12) ^ (seed2 << 18))`.

The decrypting step itself is symmetric: every byte is exclusive-ored with the low byte of a generated value.
The directory header is decrypted from the freshly seeded generator, the record block from the generator seeded
with the entry count, and every name and payload from the generator seeded with that entry's seed.

## Listing and extraction

Entries carry their decoded name, the payload offset and size, and the seed and generator index they were
encoded with, which extraction needs to rebuild the keystream. The directory declines the archive as a whole
when the header marker is missing, when the count is not sane, when a name length is out of range, or when a
payload leaves the file.

## Pictures of the engine

An entry that opens with the word `IMGX` is no picture of a kind any reader knows: `NpfOpener.OpenImage` hands
it to `ImgXDecoder`, which walks the bits of the entry itself. Behind the word stands the complement of the
count of the places the picture unfolds to, with the two halves of the word the other way round, and the walk
begins at the eighth byte: the bits of the file are taken from the least significant place of every byte first,
and the words of the walk stand of nine places at first and of one place more every time the walk meets the
word `257`. The word `256` ends the walk and the word `258` starts it again, of nine places and of a fresh
tree. What unfolds is the head of a picture of four places of the file — the count of its own places at nought,
its width at four, its height at eight, the places of a colour of a place at `0x0E` and, of a picture of one
place of the file, the count of its colours at `0x20` — and then the colours and the places of the picture
behind it. The walk hands out a bitmap.

This port reads that walk with its own least significant bit first reader
(`packages/codecs/src/lsb-bit-reader.ts`) and hands the picture out as a bitmap, of one, three or four places
of the file a place, where the reference hands it to the rendering stack of its platform. An entry that opens
with that word and unfolds to no head of a picture of those depths is refused with `INVALID_ARCHIVE`; the
reference would fail in its own walk as well. Every other entry is handed out exactly as the archive stores it.

## Deviations from GARbro

- Both generators are ported with signed 32-bit arithmetic, matching the reference's wrapping behaviour on
  overflow.
- GARbro reads names and payloads through bounds-checking views that would either throw or return short data;
  this port declines the archive when a name or payload range leaves the file.
- The walk of a picture of the engine itself is bounded: a picture of more than 256 mebibytes of places, a
  head that stands outside the places it unfolds, and a run of places that would leave them are all refused,
  where the reference reads past its own buffers in those places.
- An entry that opens with the word of the walk but unfolds to no head of a picture stands refused, as above,
  rather than handed out as it stands.

## Tests

`tests/formats/nonono-npf.test.ts` writes both generator variants to memory with test-side copies of the
generators and covers entry names with a backslash and CP932 characters, payload extraction, the empty
directory, a different version word, truncated payloads, a file without the format marker, and the pictures of
the engine: a picture of four places of the file a place and one of a palette of its own, whose places the
fixture writes the other way round of the walk, and a resource that opens with the word of the walk but
unfolds to no head of a picture. `tests/codecs/lsb-bit-reader.test.ts` covers the reader: the order of the
places, a word that reaches into the byte behind it, the end of the file, and the places of the file it is
given and no others.
