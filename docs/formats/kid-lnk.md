# KID resource archive (DAT/LNK)

## Reference and attribution

- GARbro reference: `ArcFormats/Kid/ArcDAT.cs`, class `LnkOpener` and its helper routines
- GARbro tag: `DAT/LNK`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

```
0x00  char[3]   'LNK'
0x04  int32     entry count
0x10  records   entry count records of 0x20 bytes
data            payloads at the end of the index plus the offset recorded per entry
```

Every record holds the payload offset at +0, the stored size shifted left by one at +4 and a NUL padded
CP932 name in the following 0x18 bytes. The low bit of the size field is the packed flag, and every name
has to contain something other than whitespace.

Extraction applies up to two layers:

- A packed entry whose payload starts with the `lnd` marker is an Lnd stream: the signature, the unpacked
  size at +8 and one more word in front of the commands. Lnd is a byte oriented LZ scheme with four
  commands, selected by the top bits of a control byte: a single byte run, a back reference, a literal run
  that is repeated once, and a plain literal run.
- A payload that starts with the `CPS` marker is a CPS stream. Its trailer holds the key offset, which is
  read as `u32(end) - 0x7534682`; at that offset sits a key field, and the header behind it holds the
  packed size, the compression flags and the unpacked size. The body is protected by a four byte block
  stream cipher that subtracts `rolling_key + packed_size` from every block except the one at the key
  offset, and the block at `packed_size - 4` is zeroed. The rolling key starts as
  `key_field + key_offset + 0x3786425` and advances with `key = 1103515245 * key + 39686`. Compression bit
  zero holds an Lnd command stream behind one skipped word, bit one is Lnd16 and the remaining case is a
  stored payload behind the same skipped word.

## Port notes and deviations

- Lnd16 compression raises an unsupported feature error, mirroring the `NotImplementedException` of the
  reference.
- Packed entries report an unknown size because the payload declares it, and Cps payloads are marked the
  same way since they unpack to a different length as well.
- Image and audio decoding are out of scope, as is archive creation.

## References

- `GARbro/ArcFormats/Kid/ArcDAT.cs` - `LnkOpener.TryOpen`, `LnkOpener.OpenEntry`, `LnkOpener.UnpackLnd`,
  `LnkOpener.UnpackCps`, `CpsTransform`
