# Ivory PK resource archive

## Reference and attribution

- GARBro reference: `ArcFormats/Ivory/ArcPK.cs`, classes `PakOpener`, `PkEntry` and its `Decrypt` routine
- GARbro tag: `PK/IVORY`
- GARbro baseline: `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`
- GARbro author and copyright: Copyright (c) 2015 morkt
- License: MIT

The implementation is an independent TypeScript rewrite based on GARbro behavior.

## Structure

The head is `fPK ` or `fPK2`, the byte at 3 selects the version, and the value at 4 must equal the file's
own size. Version 1 stores every length and record field as a 32-bit word and version 2 as a 64-bit long,
which widens both the header fields and the list records from twelve to twenty-four bytes.

Sections follow one another from behind that length word. Each holds a four-byte identifier, its own size,
and a header size that places its content, and because the three header fields are themselves one long
wide, the size word sits at a whole long behind the identifier — the detail that makes the two versions
read their headers differently. `cLST` skips a word and then announces a record count and a key; its
decrypted content is that many triples of a name offset, a data offset and a size. `cNAM` skips a word
before its key and holds a decrypted name pool, and it requires the list to have been seen. `cDAT` only
records where its content starts, which becomes the base offset added to every entry offset. A file
without a list, without names, or without a data section is rejected, and `*.px` entries are classified as
audio.

Payloads live inside the data section, which matters because the reference keeps reading section
identifiers as long as bytes remain: anything trailing the sections would be mistaken for a header.

## Cipher

`Decrypt` builds a thirty-two-entry schedule from the section key: each entry mixes the seed sixteen times,
folding the word and its shifted copy into the high half of a sixteen-bit accumulator, then keeps the seed
that produced it before rotating that seed left by one. Every full 32-bit word of the payload is then
permuted and exclusive-ored with its scheduled key word; a trailing partial word is left alone because the
reference only walks whole words.

The permutation is one control bit per two-bit field, starting at the least significant pair: a clear bit
copies the pair while a set bit swaps its two bits. That makes the permutation its own inverse, so
`permuteIvory` serves both directions and a caller can encrypt by permuting the word exclusive-ored with
its key. Both the schedule and the permutation are exported for that reason.

## Support

| Capability | Status |
| --- | --- |
| Both signatures and the version byte | Supported |
| File length cross-check | Supported |
| Word and long field widths per version | Supported |
| Section walk with per-version header offsets | Supported |
| `cLST` count, key and decrypted triples | Supported |
| `cNAM` key and decrypted name pool | Supported |
| `cDAT` base offset | Supported |
| Rejection of incomplete section sets | Supported |
| CP932 names and `*.px` audio classification | Supported |
| Cipher schedule and bit permutation | Supported |
| Verbatim extraction | Supported |
| Archive creation | Unsupported |

Synthetic fixtures cover both versions with encrypted list and name sections, a length word that does not
match the file, and a foreign signature.
