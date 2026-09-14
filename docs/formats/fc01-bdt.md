# Fairytale resource archive (BDT)

Reference: `GARbro/ArcFormats/FC01/ArcBDT.cs`, class `BdtOpener`, with its key tables in
`GARbro/ArcFormats/FC01/BdtTables.cs` (GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/fc01/bdt.ts` (`fc01BdtDescriptor`, `fc01BdtFormat`, id `fc01-bdt`), with the
reference's key tables in `packages/formats/src/fc01/bdt-tables.ts` (`KEY_OFFSET_TABLE`, `KEY_SOURCE`,
`KEY_SOURCE_SHIFT`, `KEY_COUNT`).

An archive of the Fairytale engine, one of a numbered family. Its header is twelve bytes — the word `PACK`, a
record count and a record size — and behind it sits **either** its own table of records or, far more often,
nothing at all.

Only the fourth archive of the family, `dt004.bdt`, carries a table. Every other one keeps its records inside
that archive, one to a file named `vom` and the number of the archive in three digits, `.dat` on the end, and
counts from the fifth archive up: `dt012.bdt` is the eighteenth archive and its records live in `vom017.dat`.
The index files are read through the index archive's **own** entries, packed and unwrapped like any other entry,
which is why the records of one archive are measured against the file they describe rather than the file they
were read from. A name that does not begin with `dt0`, a name whose tail is not a number in hexadecimal, a
missing index archive, a missing index file or an index file that will not read all mean the file is not this
format.

The record layout is the one `PAK/AGSI` uses — the unpacked size, the size, the method and the offset, all four
as words, and the name in whatever room is left — and so is the packing, including the methods that are the
encrypted twins of others. The difference is where the key comes from: instead of a scheme a user supplies, these
archives are unwrapped with keys built into the reference itself.

## Keys

`BdtOpener.GetKey` builds eight bytes out of two tables. The first table holds 1024 offsets — eight for each
archive number — and the second is a block of 1120 bytes they point into; the last five of the eight bytes count
480 bytes further into that block than the first three do. A number past the end of the table is one the
reference **throws** over rather than declines, so the port declines the file instead. The tables are transcribed
into `bdt-tables.ts` with their values and their bounds checked against each other.

## Encrypted entries

An entry unwraps as it does in `PAK/AGSI`: the head of the entry is decrypted — DES in electronic code book mode,
in a padded block — and its last four bytes are the length of what precedes them inside it, or, for an entry named
`Copyright.Dat`, its whole declared unpacked size. The head the reference reads is 1024 bytes long, or 1032 when
the entry is longer than that; whatever follows those 1032 bytes is carried as it stands behind the unwrapped
head. What comes out is then unpacked by the packing method, and a head that does not name a length, one longer
than the entry declares, or one that runs past the head itself means the entry is not readable.

The reference asks for plain DES, which OpenSSL 3 keeps out of its default provider; the port runs the same key
through the three key slots of triple DES, where the middle step unwraps exactly what the first one wrapped, so
the cipher and its result are the same.

## Media kept under the extension

A `.bdt` file that does not begin with `PACK` may not be an archive at all: the reference hands an Ogg file, or a
RIFF file tagged `AVI ` eight bytes in, over as a **single entry** named after the file with `ogg` or `avi` on
the end, the Ogg one typed as audio. A RIFF file with another tag, or media under another extension, is not this
format.

The reference registers its word beside a zero, which asks for every file to be tried, and the port reproduces
that with `extensionFallback`; the archive's own extension is only what the media check and the archive number
are read from.

The tests cover the word with the one that asks for every file, the index archive reading its own records, an
archive taking its records out of the index archive beside it, the numbering of the index files from the fifth
archive up, a missing index archive and a missing index file, names that are not of the family or carry a number
past the key table, the golden key bytes of two archive numbers, an entry unwrapped with the key its number picks
out, an entry longer than the head the reference reads, the media fallback for Ogg and `AVI ` files with the
files that look like them but are not, and a record with no name and an entry that does not fit.
