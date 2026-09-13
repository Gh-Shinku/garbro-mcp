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

## Deviations from GARbro

- Both generators are ported with signed 32-bit arithmetic, matching the reference's wrapping behaviour on
  overflow.
- GARbro reads names and payloads through bounds-checking views that would either throw or return short data;
  this port declines the archive when a name or payload range leaves the file.

## Tests

`tests/formats/nonono-npf.test.ts` writes both generator variants to memory with test-side copies of the
generators and covers entry names with a backslash and CP932 characters, payload extraction, the empty
directory, a different version word, truncated payloads and a file without the format marker.
