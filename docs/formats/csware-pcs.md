# C's ware resource archives (PCS)

## Reference and attribution

- GARbro reference: `ArcFormats/CsWare/ArcPCS.cs`, classes `PcsOpener` and `PcsArchive`, with the generator of
  `ArcFormats/MersenneTwister.cs`
- GARbro tag: `PCS`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The archive opens with `PCCS` and carries a version between 1 and 6. The reference gives it no extension.

## Layout

```
[u8 'PCCS'] [u16 version at 0x04] [u16 shuffle key at 0x06] [i32 count at 0x08]
[u32 data offset at 0x0C] [index from 0x10] [payloads from the data offset]
```

The index fills the space between 0x10 and the data offset, and the count must be sane, which means greater
than zero and below 0x40000.

## Records

Every record starts with a name field, which is a 32 bit length, one byte and the name itself:

| Version | Record |
| --- | --- |
| 1 | name field, then a sixteen byte footer |
| 2 to 5 | a repeated name field that is skipped, the name field, then the footer |

The repeated field of the later versions is walked over with the same length arithmetic and is never decrypted.
Both fields are cp932 and a zero length ends the table, so fewer entries than the count are allowed.

`DecryptName` swaps the nibbles of every name byte up to the first NUL and sums the *decrypted* bytes into a
checksum.

## Footer and payloads

From version 4 on the footer holds the payload offset and size scrambled with the name checksum:

- `base` is `-1 - checksum`, taken as a byte;
- for the byte at index `j` of the first word, and the byte at `j + 4` of the second, the key is
  `(checksum + (17 << j)) & 0x33` and the stored byte is `base + key - plain`.

The payload offset is relative to the data offset, and every payload has to fit inside the file. Below version
4 the footer is stored plainly and payloads are handed back as they are stored.

Extraction decrypts the first 512 bytes of a payload, and only those: from version 6 the header is shuffled in
blocks first, then every byte of it becomes `key - byte - 1`. The rest of the payload stays as it is stored.

## Shuffling

`ShuffleBlocks` cuts the buffer into 32 blocks and seeds the mersenne twister with a key. Every block copies a
source block picked by `Rand() & 0x1F`, skipping the blocks it already copied and moving on by one when it
picks one twice. A tail that does not fill a whole block is copied as it is. The index is shuffled with the
sixteen bit key from the header, and a version 6 payload header with the name hash, which is the first four
bytes of the SHA-1 of the decrypted name without its last byte, read big endian.

The generator seeds its state with the congruential routine of the reference and leaves the position at the end
of the state, so the first draw twists it.

## Port notes and deviations

- A negative length prefix makes the reference read an empty name. The port declines such a record instead.
- Archive creation stays out of scope.

## References

- `GARbro/ArcFormats/CsWare/ArcPCS.cs` - `PcsOpener.TryOpen`, `PcsOpener.OpenEntry`, `PcsOpener.DecryptName`,
  `PcsOpener.ShuffleBlocks`, `PcsOpener.ComputeHash`
- `GARbro/ArcFormats/MersenneTwister.cs` - `MersenneTwister.SRand`, `MersenneTwister.Rand`
