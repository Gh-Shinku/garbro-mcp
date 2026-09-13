# Inspire resource archives (IDA)

## Reference and attribution

- GARbro reference: `Legacy/Inspire/ArcIDA.cs`, classes `IdaOpener` and `RleDecompressor`
- GARbro tag: `IDA`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

The archive opens with `XAF`, keeps a version at 0x04 and stores records from 0x08. Files that GARbro finds
under this tag include the `ida` and `mha` extensions.

## Layout

```
[u8 'XAF'] [i32 version at 0x04] [records from 0x08] [payloads]
```

The version must not be ahead of 0x011400. Every record starts with a length and repeats a fixed 0x28 byte
header:

| Offset | Field |
| --- | --- |
| 0x00 | record length, including the name |
| 0x04 | payload offset |
| 0x08 | declared payload size |
| 0x10 | flags |
| 0x14 | key |
| 0x28 | serialized name |

Records follow one another until the record cursor reaches the payload of the first entry, and a record whose
length is zero ends the table. The payload of an entry may not start in front of the end of its own record, and
it may not be beyond the end of the file.

## Names

`DeserializeLength` reads one byte and treats it as:

- a byte length, when it is below 0xFF;
- the low half of a sixteen bit length behind a 0xFF byte, where 0xFFFE marks a wide name and 0xFFFF a length
  stored in a full 32 bit word.

`DeserializeString` then reads that many bytes as CP932, cut at the first NUL, or twice that many bytes as
UTF-16 when the length was 0xFFFE. A length of zero keeps the entry nameless.

## Flags and codecs

`OpenEntry` runs the codecs in this order: decryption when any of the 0x0B bits are set, then the rle
decompressor when 0x04 is set, then zlib when 0x10 is set.

Decryption transforms every byte by the low byte of the key and reuses the *result* as the key of the next byte:

- 0x08 adds the key;
- 0x02 xors the key;
- 0x01 complements the byte.

The rle stream starts with its own 32 bit output size. Every control byte then carries a count in its low six
bits unless bit 0x80 is set, in which case the low two bits choose where the count comes from: zero reads one
byte, one reads sixteen bits and three reads a full 32 bit word. Bit 0x40 turns the run into repetitions of the
next byte, otherwise the run is a literal copy. The count is capped at the announced output size.

When any entry sets one of the 0x14 packed bits, the archive reports every payload size as the distance to the
next payload, with the end of the file closing the last one. The declared size stays the unpacked size, so the
port reports it as the entry size and the adjacent distance as the stored size.

## Port notes and deviations

- The reference reads the name without bounding it by the record length. The port confines every name to its
  own record, which declines malformed archives instead of consuming the next record's header.
- A control byte that both sets 0x80 and ends in the low bits 10 leaves the count at zero in the reference,
  which cannot make progress. The port ends the stream there.
- Archive creation stays out of scope.

## References

- `GARbro/Legacy/Inspire/ArcIDA.cs` - `IdaOpener.TryOpen`, `IdaOpener.OpenEntry`, `IdaOpener.DecryptEntry`,
  `IdaOpener.DeserializeString`, `IdaOpener.DeserializeLength`, `RleDecompressor.Unpack`
