# AbogadoPowers resource archive

Reference: `GARbro/ArcFormats/Abogado/ArcPAK.cs`, classes `PakOpener` and `Fs8Archive`. GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License. The substitution tables come from the reference asset
`GARbro/ArcFormats/Abogado/keytable.dat`, which is part of the same MIT licensed distribution.

Implementation: `packages/formats/src/abogado/pak.ts` (`abogadoPakDescriptor`, `abogadoPakFormat`, id
`abogado-pak`, `readAbogadoIndex`, `decryptFs8`) and the transcribed asset in
`packages/formats/src/abogado/keytable.ts`. The DSK archives of the same engine are ported in
`docs/formats/abogado-dsk.md`.

The reference registers the word of nothing, so the format is a candidate for every file. The archive begins
with a count of records and a word that says how it stands — nothing, or the substitution of the engine's FS8
archives — and then one record each of seventy two bytes: a name of sixty four bytes cut at its first NUL and
read as CP932, the place of the entry and its length. A blank name, a record that leaves the file or an index
the file cannot hold turns the whole attempt down, and the count has to be sane.

An archive whose word says nothing hands its entries out as they stand. Behind **every** entry of an FS8
archive stands its length again as a thirty two bit word — the number of the substitution table the entry is
put through — and every byte of the entry is then that table's entry for it. Two details are kept as the
reference has them:

* where the number is below nothing, or past the **one hundred and twenty eight** tables the asset holds, the
  reference hands the entry out **as it stands** rather than failing;
* the word has to stand inside the file: the reference reads it straight past the end of an entry, which throws
  for an entry that ends at the end of the archive. The port refuses that entry instead
  (`INVALID_ARCHIVE`, a documented deviation in the message only).

The key table is GARbro's `keytable.dat` transcribed mechanically into
`packages/formats/src/abogado/keytable.ts`: 128 tables of 256 bytes, each a permutation of the byte values,
32 KB of base64. The module carries the SHA-256 of the reference asset and the tests check the transcription
against it, along with the length of the table and the fact that every table is a permutation.

The tests cover the index, each record the reference turns down, the names of the index written into paths, an
entry of an archive that stands as it is, an entry put through a table, the numbers that are no table, an entry
whose number is not in the file, and the transcription of the asset.
