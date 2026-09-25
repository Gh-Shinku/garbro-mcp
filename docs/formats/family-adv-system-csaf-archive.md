# Family Adv System resource archive

Reference: `ArcFormats/FamilyAdvSystem/ArcCSAF.cs`, classes `CsafOpener` with `CsafEncryption` and `CsafStream`
beside it. GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`. Implemented as
`family-adv-system-csaf-archive` (`packages/formats/src/family-adv-system/csaf-archive.ts`).

## The head and the index

The archive opens with the word `CSAF`. The word behind it holds two things: its lowest bits have to name
sixty five thousand five hundred and thirty six and nothing else, and its highest bit says whether the names
the archive keeps are wrapped. Then how many entries stand in it, how long its names are, and a digest of the
whole index - which is the two of them together, the records and the names.

The index stands at the end of the head and its records are held in **whole pages**, with a piece of the head
of its own behind them; the names follow the pages. Even in a wrapped archive the records stand as they are:
only the names behind them are unwrapped. The digest is taken once the names stand plain, and the reference
turns away any archive whose digest does not match its own index.

A record names the page its entry begins at, counted in whole pages, and how long the entry is. A name is held
as text of two bytes to a character and ends at a pair of nothing bytes; the record behind it stands ten bytes
beyond that end.

## The wrapping

`CsafEncryption` builds its key out of a phrase - the one the engine was built with stands in the reference as
`江ノ島の南`, and a scheme of a game title may name another - by taking the text of it with two bytes to a
character twice over with one byte between them, each time through a digest. What a caller unwraps is then
read a **page at a time**, every page with a key of its own: the key is built by turning sixteen bytes of the
phrase key around by as many places as the page's place among every eighth page, taking the digest of that,
and doing the same again out of the second half of the phrase key. The two digests side by side are the key of
the page, and what they unwrap is read with the cipher of the archive - a common one, with the sixteen bytes
`FamilyAdvSystem ` as the place it begins at.

The names are unwrapped as one run of the place the index ends at, with the key of the first page.

## Deviations from the reference

* The reference reads a page only when a caller reaches it; this port reads the archive and unwraps the pages
  an entry stands in, so a file of the same size is held in memory once.
* A page the archive does not hold in full is refused, as the reference's own page reader does.
* The reference asks a scheme of game titles for the phrase and falls back to the one above; this port reads
  the phrase the reference falls back to.

## Verification

Six tests over synthetic fixtures (`tests/formats/family-adv-system-csaf-archive.test.ts`): the head and the
shape its flags have to keep; the names of an archive whose index matches its digest, with the kind of every
name told from its extension; the payload of every entry, one of which reaches over two pages; an archive
whose names and whose pages are wrapped, built by the test with the very keys the reader derives, since a
cipher of this kind is written the other way round by turning the same place and the same key around; an
archive whose index has been changed by one bit, which the digest catches; and an entry that holds nothing.
