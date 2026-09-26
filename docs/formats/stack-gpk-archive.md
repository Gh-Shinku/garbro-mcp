# `stack-gpk-archive`

A resource archive of the Stack script engine. The port is read from `ArcFormats/Stack/ArcGPK.cs`, class
`GpkOpener`, at GARbro's baseline commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`.

## The format

The index of the archive stands at its **end**, not at its head, and the pictures and scripts it names stand
in front of it. The last thirty-two places of the file hold the two words that name the index and the count
of its places:

| at the foot | of what count | what stands there |
| --- | --- | --- |
| 0 | 12 | the words `STKFile0PIDX` |
| 12 | 4 | the count of the places of the index |
| 16 | 16 | the words `STKFile0PACKFILE` |

The index begins the count at 12 back from that foot. Its places are **exclusive-ored** with a cipher, the
first four places of the index are skipped, and everything behind them is a zlib stream. The cipher is the
part of the format that does not stand in the file: the engine keeps it in a resource of the game's own
executable, and the reference takes it from the resource named `CODE` of the kind `CIPHERCODE` of an
executable of the directory **above** the archive and then of the archive's own directory, in that order.
Where the resource stands of twenty places the reference takes the sixteen behind the first four, and of a
resource of any other count it takes the whole of it. Where no cipher can be found the reference refuses the
whole archive (`QueryKey` answers nothing), and so does this port.

The index, once unwalked, is a list of records:

| at | of what count | what stands there |
| --- | --- | --- |
| 0 | 2 | the count of the places of the name of the entry, of two places of the file each |
| 2 | the count above | the name of the entry, of the places of the engine |
| behind the name | 4 | places the reference stands of no use of |
| behind those | 2 | places the reference stands of no use of |
| behind those | 4 | the places of the entry within the file |
| behind those | 4 | the count of the places of the entry |
| behind those | 4 | places the reference stands of no use of |
| behind those | 4 | the count of the places the entry stands of where its places are packed, of nought where they are not |
| behind those | 1 | the count of the places of the head of the entry |
| behind that | the count above | the head of the entry |

A record whose count of the places of a name is nought ends the list, an entry whose places stand past the
end of the file is refused, and a list of no entry at all is refused.

## What the port does with the places of an entry

The places of an entry are read, and where the record names a head, the head is put **in front of** them.
Where the record names a count of unpacked places, the zlib walk is then taken over the whole of the two -
the head and the places - which is the order the reference stands of them (`PrefixStream` and then
`ZLibStream`), so a head of an entry stands **inside** the compressed stream and not in front of it.

## Deviations

* The kind of an entry's name is not worked out. The reference builds an entry through
  `FormatCatalog.Create`, which names a kind from the file's own name through its table of the places of a
  name (the aliases this project writes down in `docs/format-aliases.md`); this port names every entry
  `file` and leaves the kind to the caller. The walk of the places of the file itself is unaffected.
* An archive standing **within** another archive stands of no cipher here, as it stands of none in the
  reference: the reference answers `null` from `QueryKey` where the archive is virtual, and this port looks
  for no executable beside an archive it was given without a path.
* An executable of more than 33 554 432 places of the file is left out of the search for the cipher, a
  bound this port adds and the reference does not carry.
* The reference grows its own buffer of the places of a name where a name stands beyond it, so a name of any
  count is read; this port bounds no name either, and only bounds what the walk itself bounds.

## Verification

`tests/formats/stack-gpk-archive.test.ts` builds both halves in the test: an archive of two entries, one
plain and one packed, of which one carries a head, and a minimal portable executable of one `.rsrc` section
that carries the cipher as the resource of the kind `CIPHERCODE` named `CODE` (both the kind and the name
stand of a name, so the two upper levels of the tree of the resources stand of names as well). The names,
the counts, the packed flags, the head in front of the places and the walk of the packed entry stand pinned,
the two ways the resource of the cipher is taken stand pinned, a file of another word at its foot and a file
of no executable beside it stand refused, and an archive of no executable beside it stands refused where its
places are asked for.
