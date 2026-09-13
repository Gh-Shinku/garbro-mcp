# Ellefin Game System resource archive (EPK/Ellefin)

## Reference and attribution

- GARbro reference: `ArcFormats/Ellefin/ArcEPK.cs`, classes `EpkOpener`, `EpkEntry`, `EpkInfo` and
  `EpkIndexReader`
- GARbro tag: `EPK/Ellefin`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Layout

The archive starts with the `EPK` signature and a flag byte, followed by the index length.

```
+0  char[3]  "EPK"
+3  byte     flags
+4  uint32   index length
+8  byte[]   index
```

Flag bits: `0x01` addresses payloads and sizes in `0x800` byte units, `0x02` is required, `0x04`
applies the content cipher to whole entries, `0x08` ciphers the first `0x10` bytes of every entry, and
any of `0xF0` marks an encrypted index. Ellefin numbers the cipher bits one lower than the Lucifen
archive it descends from, and its default scheme constants differ as well, so the two use separate
scheme tables.

When the index is encrypted its length word is xored with a second key and the index itself is xored
word by word with that key while a pattern word rotates left by four: the key rotates right by the
pattern after every word. Both keys start from the scheme base key and are mixed with the upper case
base name of the archive: the first key xors the name bytes back to front and the second front to back,
rotating by eight bits after every step. Bit `0x01` then turns the length into a block count, and the
eight byte header is subtracted for the flat index and for every aligned archive.

The decrypted index is either flat or a letter table:

```
+0  int32    entry count

flat index
    byte     name length
    byte[]   name
    12 bytes offset, stored size, unpacked size

letter table index
    byte     prefix length
    byte[]   prefix
    byte     non zero selects four byte letter offsets, otherwise two
    int32    name tree length
    byte[]   letter table
    12 bytes per entry, addressed by the terminal values
```

The letter table is a prefix tree; a node is a byte count followed by that many `letter, offset` pairs
whose offsets are relative to the byte after the offset field. A non zero letter descends into the child
node and appends the letter to the name; a zero letter terminates the name and its value is the index of
a twelve byte record. Records are read after the whole tree has been walked, so the entry order follows
the letter table rather than the record table. The flat index stores a length prefixed name directly in
front of each record instead.

## Extraction

An entry whose unpacked size is non zero is a shared `LzssStream`; otherwise the stored size is also the
extracted size. Bit `0x04` then applies the content cipher to the whole entry, which xors every byte
with `0xD9` and nibble rotates it right by four. Bit `0x08` applies the entry cipher to the first `0x10`
bytes, which is the index rotation with the pattern and key rotations mirrored. Finally the index prefix
is copied over the first bytes of the entry, replacing them rather than extending the entry, and only
when it fits.

## Port notes and deviations

- The reference registers both `EPK` signature variants plus the always-try marker. The port leaves the
  candidate gate open and relies on its own detection so that any flag combination is accepted, like the
  reference.
- Only the built in default scheme is implemented, which is all this format uses.
- Payload placement is validated; the reference leaves unplaced entries to fail during extraction.
- Archive creation and image decoding are out of scope.

## References

- `GARbro/ArcFormats/Ellefin/ArcEPK.cs` - `EpkOpener.TryOpen`, `EpkOpener.OpenEntry`,
  `EpkIndexReader.Read`, `EpkIndexReader.ParseEncryptedIndex`, `EpkIndexReader.ParseRegularIndex`,
  `EpkIndexReader.ReadEntry`, `EpkIndexReader.TraverseIndex`
- `GARbro/ArcFormats/Lucifen/ArcLPK.cs` - the shared `EncryptionScheme` rotations
