# Pias encrypted resource archive (DAT/PIAS/ENC)

## Reference and attribution

- GARbro reference: `Legacy/Pias/EncryptedGraphDat.cs`, classes `EncryptedDatOpener`,
  `EncryptedIndexReader`, `KeyGenerator`, `PiasTransform`
- GARbro tag: `DAT/PIAS/ENC`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- License: MIT

## Detection

Only `sound.dat` and `graph.dat` are served, and the file name decides which of them it is. The format
declares two signatures, `0x02F3A62B` and zero, which describe the encrypted `text.dat` list rather than the
archive itself. The archive opens when that list can be read and decrypted.

## Key generator

`KeyGenerator` is a shift register seeded per entry. Three parameter pairs are defined for the graph, text
and save archives; a type outside that range contributes nothing. One step is

```
value    = x + seed * y            (modulo 2^32)
feedback = bit22 xor bit10 xor bit0
seed     = value >> 1 | feedback << 31
```

and the step's result is the new state, whose low byte is the mask for one byte of data. Every encrypted
region restarts from the seed given for it, so the phase always begins at the first byte.

## Index

The sibling `text.dat` list starts with a little endian signature and is decrypted from offset four with
the text key seeded by that signature. Lists whose signature is neither `0x02F3A62B` nor zero are declined.
The decrypted list is the usual opcode chain of resource offsets.

A `sound.dat` archive then keeps the plain index layout: the text list gives the offsets, and the rest of
the chain is walked the same way as the unencrypted Pias format.

A `graph.dat` archive is fully encrypted. Every entry starts with a seed word followed by an encrypted span
of the recorded size, so the chain advances by that size plus the four seed bytes. The first four decrypted
bytes hold the size field, of which the low twenty bits are kept before eight header bytes are added. The
reference walks the text list backwards to replace each size, then walks the whole file from the start and
appends the entries the list did not mention, naming them with the zero padded offset and an underscore.

## Extraction

A graph entry is read from behind its seed word for the recorded number of bytes and decrypted with a
graph key seeded by that word, which covers the size field, the payload and, for the last entry, exactly
the end of the file.

Sound entries keep the plain Pias behaviour except for the PCM format: extraction prepends a 44 byte
RIFF/WAVE header for sixteen bit stereo at 22050 Hz, a byte rate of 88200 and a block alignment of four.

## Port notes and deviations

- Archive creation is out of scope, as is the `EncryptedGraphDecoder` image decoder.
- The reference re-reads every entry name from its recorded offset while it walks the list; the port keeps
  the index numbered names, which are the same.
- A record shorter than its eight byte header declines the archive instead of reading a zero filled view.
- The recorded size can run past the end of the file for the final entry, and the extracted span is
  truncated at the end of the file like the reference's clamped view.

## References

- `GARbro/Legacy/Pias/EncryptedGraphDat.cs` - `EncryptedDatOpener.TryOpen`,
  `EncryptedDatOpener.OpenEntry`, `EncryptedDatOpener.OpenEncrypted`,
  `EncryptedIndexReader.GetIndex`, `EncryptedIndexReader.Decrypt`, `KeyGenerator.Next`,
  `PiasTransform.TransformBlock`
- `GARbro/Legacy/Pias/ArcDAT.cs` - `DatOpener`, `IndexReader`, `TextReader`
