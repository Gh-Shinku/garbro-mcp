# NitroPlus Steins;Gate resource archive (NPA-SG)

## Reference and attribution

- GARbro reference: `ArcFormats/NitroPlus/ArcSteinsGate.cs`, classes `NpaSteinsGateOpener`,
  `SteinsGateEncryptedStream`
- GARbro tag: `NPA-SG`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Detection and key

The format has no signature, so the index decides. Everything after the first four bytes is XORed with an
eight byte key, which is `BUCK` and `TICK` with every bit flipped:

```
bd aa bc b4 ab b6 bc b4
```

The key phase is taken from the start of each encrypted region, so the index and every entry payload begin
at the first key byte.

## Index

The first little endian word is the index size, which has to be at least 0x14, smaller than the file, and
at most 0xffffff. The index itself starts at offset four and holds a little endian entry count followed by
records:

```
int32         name length in bytes
byte[]        name
uint32        stored size
int64         absolute offset
```

The entry count has to be sane and the average record size, the index size less the count divided by the
entry count, has to be at least 0x11, which means every entry needs a name of at least one byte. Every
record is checked against the remaining index size, and every entry has to fit inside the file.

## Names

Names are raw bytes. A name holding a zero byte is decoded as UTF-16LE, a name with a byte above 0x7f is
decoded as cp932, and everything else is ASCII.

## Extraction

The stored payload of an entry is XORed with the same key, with the phase restarting at the first key byte
for every entry, so the stored size is also the extracted size.

## Port notes and deviations

- Archive creation is out of scope, even though the reference supports it.
- A name whose UTF-16LE bytes have an odd length loses its trailing byte, because that is how the platform
  decoder handles an incomplete code unit.
- The index is read in one block rather than through a seeking stream; a truncated index declines the file
  instead of raising an end of stream error.

## References

- `GARbro/ArcFormats/NitroPlus/ArcSteinsGate.cs` - `NpaSteinsGateOpener.TryOpen`,
  `NpaSteinsGateOpener.OpenEntry`, `NpaSteinsGateOpener.GuessEncoding`,
  `SteinsGateEncryptedStream.Read`
