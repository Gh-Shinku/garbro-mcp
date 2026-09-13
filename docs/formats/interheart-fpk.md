# Interheart / Candy Soft resource archives (FPK)

## Reference and attribution

- GARbro reference: `ArcFormats/Interheart/ArcFPK.cs`, classes `FpkOpener` and `Zlc2Reader`
- GARbro tag: `FPK`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The format has no signature and no extension of its own in the reference, so the index itself is the gate.

## Layout

```
[i32 count] [records] [payloads]
```

Every record is an offset, a size and a fixed name field, and the payloads start behind the index:

| Name field | Record size |
| --- | --- |
| 0x10 | 0x18 |
| 0x18 | 0x20 |

The reference tries the smaller field first and retries with the larger one, so an archive that only parses
with twenty four byte names still opens. In this layout, `data offset` is the end of the index and every
payload has to start at or behind it.

A name is CP932 and cut at its first NUL; a blank name declines the archive.

## Encrypted index

A count whose sign bit is set (`0x80000000 | count`, not a negated count) switches to the second layout, where
the index lives at the very end of the file:

```
[i32 count and flag] [payloads] [encrypted index] [u32 key] [u32 index offset]
```

The index offset must be at least four and in front of the key, every record is an offset, a size, four unused
bytes and a twenty four byte name, and the whole index is xored with the four key bytes, repeating them. The
records must fit inside the file and every payload has to be placed inside it.

## Payload encoding

`OpenEntry` unwraps `ZLC2` streams as long as the payload in hand starts with that marker and is longer than
eight bytes, so a payload may be layered.

A `ZLC2` stream is an eight byte header with the marker and the unpacked size, followed by groups of eight
decisions taken from one control byte, most significant bit first:

- a clear bit is a literal byte;
- a set bit is a back reference built from two bytes, where the first one holds the low eight bits of the
  offset, the high nibble of the second one extends it by four more bits, and its low nibble carries the
  length minus three. An offset of zero means 4096.

The reference copies with overlap, so a run can repeat the bytes it just wrote, and the length is capped at the
declared unpacked size.

## Port notes and deviations

- The reference allocates the announced unpacked size without a bound; the port refuses an absurd one.
- A crafted stream could keep wrapping itself forever, so the port stops unwrapping after 32 layers.
- The reference describes the contained formats of this archive type, which the port does not use for entry
  typing.
- Archive creation stays out of scope.

## References

- `GARbro/ArcFormats/Interheart/ArcFPK.cs` - `FpkOpener.TryOpen`, `FpkOpener.ReadIndex`,
  `FpkOpener.ReadEncryptedIndex`, `FpkOpener.OpenEntry`, `Zlc2Reader.Unpack`
