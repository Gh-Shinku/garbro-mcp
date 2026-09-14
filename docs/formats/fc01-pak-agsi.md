# AGSI engine resource archive (PAK/AGSI)

Reference: `GARbro/ArcFormats/FC01/ArcPAK.cs`, class `PakOpener`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/fc01/pak-agsi.ts` (`fc01PakDescriptor`, `fc01PakFormat`, id
`fc01-pak-agsi`), with the bit stream decoder exported as `decodeLzBitStream`.

An archive of the Advanced Game Script Interpreter engine. Its header is twelve bytes — the word `PACK`, a
record count and a record size — and behind it sits a table of records, with the data where the table ends. The
reference registers the word, the AGSI word the engine's own archives begin with (`0x24A02028`) and a **zero**
beside them, which asks for every file to be tried; the port reproduces that with `extensionFallback`.

An archive that does **not** begin with `PACK` is one whose header is encrypted. Two bytes near the end of the
file — the ninth and the sixth from the last — are the key: the first walks along the header a byte at a time and
the second, masked to three bits and taken as one when it comes out zero, is how far each byte is turned to the
left before it is mixed. A header that does not come back as `PACK` is not this format. The **index** of such an
archive is encrypted as well, with the draws of an MT19937 twister seeded 7524, each draw turning a byte left and
mixing it with its own low byte.

A record holds the unpacked size, the size, the packing method and the offset of an entry, all four as words, and
then its name in whatever room is left; the offset counts from where the index ends, the record size has to be
more than `0x10` and no more than `0x100`, and a record with no name, or one that does not fit inside the file,
means the whole file is not this format.

## Encryption and packing

A method of **three, four, five or seven** is the encrypted twin of zero, one, two and six. Unwrapping one takes
an encryption scheme the reference keeps in a resource file a user supplies, looked up by the game its `.sb`
script names, and it **declines the whole archive** when it has no scheme for it. The port declines every such
archive for the same reason, which is a deliberate omission rather than a partial implementation: the entry
decryption — DES in ECB with a zero-padded head whose first bytes carry a length, and a name of `Copyright.Dat`
that is treated specially — is documented here and not reproduced.

What is left is the packing:

| method | meaning |
|---|---|
| 0 (and 3) | stored |
| 1 (and 4) | run length, which the reference's own `RleDecompressor.Unpack` throws `NotImplementedException` for — the port raises an unsupported feature error in its place |
| 2 (and 5) | a bit stream, decoded here |
| 6 (and 7) | the library's LZSS, read to the end of the stream as the reference reads it rather than to the size the record declares |

The bit stream is read from the most significant bit down. A set bit is a literal byte; a clear one is a match of
an offset of twelve bits and a length of four bits more than two, taken from a frame of `0x1000` bytes. Two
details matter:

* the frame's write position starts at **one** rather than at nothing, so the frame's first byte is never written
  by a literal and a match at offset zero always reads a zero;
* a match is counted against the size the record declares before it is copied, so the copy finishes and the
  output can run a few bytes **past** that size — the reference stops between pixels rather than inside one.

A stream that runs out before that size ends quietly, giving whatever was decoded, which is what the reference's
bit reader does when it reports the end of its input.

The reference takes the type of every entry from its own catalogue of formats, so the port leaves that field out
rather than guessing at it; what it does report for each entry is the method, the unpacked size and whether the
name is the one special name.

The tests cover the two words with the word that asks for every file, a plain index with its records, the data
offset and the special name, a header and an index that are both encrypted, a stored entry, an LZSS entry, a bit
stream whose match overlaps itself, a bit stream that runs past its declared size, the run length method the
reference never implemented, an archive holding an encrypted entry of each of the four kinds, and a record with no
name, a record size out of range and an entry that does not fit.
