# Pinky Soft resource archive (A5R)

## Reference and attribution

- GARbro reference: `Legacy/Pinky/ArcA5R.cs`, classes `A5rOpener`, `A5rEntry`, `A5Segment` and
  `A5rStream`
- GARbro tag: `A5R`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

The archive is identified by two signatures, `PCRS` and `PLIB`, and the second word is always the
bitwise complement of the first.

```
+0   uint32   signature
+4   uint32   complement of the signature
+0x30 int32   segment count
+0x34 uint32  segment table offset
```

The segment table is a chain of records that overlap, because each record's last field is the next
record's offset. It starts with the first segment offset, then ten bytes per record:

```
uint32   next offset, which is also the following record's leading word
uint32   unpacked size
byte     type
byte     compression, 3 selects zlib
uint32   next offset
```

The size of a segment is the distance to the next offset, so the table has to be monotonically
increasing and the last offset has to stay inside the file. A decreasing offset rejects the archive.
Payloads are usually laid out after the table in record order.

## Entries

Entry names are generated from the archive base name, not stored: `{base}#{index:D5}` with a five digit
decimal index, counted per segment rather than per entry.

A segment of type `0x3E` is an image and gets a `.bmp` extension. A segment of type `0x3C` is audio and
is probed for a RIFF header, which has to be read through its own decompression if it is a zlib stream.
When the probe succeeds, the entry becomes `{base}#{index:D5}.wav` and the following audio segments are
appended to it until the accumulated unpacked size reaches the RIFF size declared in the probe or the
next segment turns out not to be audio. An audio segment whose probe fails stays a plain entry. Every
other segment is a plain entry as well.

Extraction concatenates the decompressed contents of the entry's segments, which for a single segment is
just that segment. Sizes come from the recorded unpacked size, so an entry whose stored and unpacked
sizes differ, or which contains a compressed segment, reports its size as unknown until it is decoded.

## Port notes and deviations

- The reference reads the RIFF probe through eight bytes of a decompressing stream. The port decompresses
  the whole first segment to test it, which is what the extraction needs anyway.
- Only zlib is supported as a segment codec, which is the only value the reference implements.
- The reference treats out of range table reads as fatal. The port rejects such archives outright.
- Archive creation and the `A5R` image decoder are out of scope.
- The reference records each entry's type from its name through the format catalog. The port stores
  `audio` and `image` for the two special segment types and leaves the rest empty.

## References

- `GARbro/Legacy/Pinky/ArcA5R.cs` - `A5rOpener.TryOpen`, `A5rOpener.OpenEntry`, `A5rStream.Read`,
  `A5rStream.NextSegment`
