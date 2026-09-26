# Microsoft cabinet archive (`CAB`)

Reference: GARbro `Experimental/Cabinet/ArcCAB.cs`, class `CabOpener` (GARbro commit
`b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT License). Implemented as
`packages/formats/src/microsoft/cab-archive.ts`, registered as `microsoft-cab-archive`.

A cabinet holds its files inside *folders*, and it compresses each folder as a whole rather than file by
file. The reference carries no walk of the format at all: `CabOpener.TryOpen` hands the path to
`Microsoft.Deployment.Compression.Cab`, the managed cabinet reader of the WiX deployment tools, and
`OpenEntry` hands each entry to `CabFileInfo.OpenRead`; the library stands outside the tree, and the
reference's own `CabEntry` records only that the offset of every entry is unknown and reported as `0`. What
is written here is therefore a reader of the format from its specification, in the standing this project
gives the other formats whose reference leaves the work to a library of its platform. The note records
where the reader goes beyond the reference and where it stops.

## The head

The cabinet opens with `MSCF`, the length of the whole cabinet, the place of the table of files, the
version of the format, the counts of folders and of files, the flags of the head, the number of the set and
the number of this cabinet inside it. Between the head and the table of folders stand, in this order:

* the room another program reserved, named by the head flag `0x0004`: a word of length, a byte for each of
  the following two records, and the reserved bytes themselves;
* the names of the cabinet before this one and of the disk that held it, named by the flag `0x0001`;
* the names of the cabinet behind this one and of its disk, named by the flag `0x0002`.

The port walks all three, so a cabinet of a set is read like any other.

## Folders and files

Every folder record names the place of its first block of data, the count of its blocks, and how they are
compressed. The kind of the compression stands in the **low byte** of the last word: `0` for the bytes as
they stand, `1` for the deflate of MSZIP, `2` for Quantum and `3` for LZX. The **high byte** of that word
carries a parameter of the compression, which the port reports as `parameter` and does not use: it reads
nought in the cabinet of MSZIP checked here, and fifteen and twenty one in the two cabinets of LZX of
Windows that were checked, which stands with a window of thirty two thousand and of two million bytes. The
port therefore tells the kind from the parameter rather than comparing the whole word, so that a folder
whose word reads `0x0100` is a folder of no compression.

Every file record holds the length of the file before it is unfolded, the place of its bytes inside its
folder, the number of its folder and three words of date and attributes, and **its name stands behind its
own record**. That last point is worth stating because it is easy to get wrong: the table is not a run of
fixed sixteen byte records followed by a run of names, so the record of a file cannot be found by
multiplying the file number by sixteen. A real cabinet of Windows — the MSZIP one this port was checked
against, whose file table starts at `0x44` — writes `appraiser.sdb` at `0x54`, which is exactly one record
behind the first, and the second record at `0x62`, which is exactly one name behind that. The port walks
the table record by record, and a fixture whose two files carry names of different lengths pins the walk.

A file whose length reads `0xffffffff` continues into the cabinet behind this one. The port lists it, marks
it as continued in its metadata, reports `sizeKnown: false` for it because its true length is only known
once the cabinets are read together, and hands over the part of it this cabinet holds: everything its
folder keeps behind its own place. `0xffffffff` bytes are never promised.

## The blocks of a folder and the window of MSZIP

The blocks of a folder follow the head. Each block opens with a check word, the length of its compressed
bytes and the length of the bytes they unfold to, and then those bytes.

* A folder of compression `0` holds its bytes as they stand.
* A folder of compression `1` holds blocks of MSZIP. Each block opens with the letters `CK` and holds one
  whole deflate stream, and **the window of that stream stands at the bytes the blocks before it unfolded
  to**, so the reader is handed the last thirty two thousand bytes of everything the folder has unfolded so
  far as the dictionary of the block it is reading. The first block of a folder is handed no dictionary.
* A folder of compression `2` or `3` is listed but not unfolded: extraction is refused with
  `UNSUPPORTED_FEATURE`, which is how this project treats a payload it does not read. The reference reads
  both through its library; a note of this project's deferred list says what stands behind them.

The port turns a block away when it is missing its `CK` letters, when its bytes are no deflate stream, when
it unfolds to a length other than the one it names, or when it reaches past the end of the cabinet. The
check word is not verified: the format leaves its meaning to the program that wrote the cabinet and neither
the reference nor its library reads it.

## Deviations from the reference

* The reference hands the path of the cabinet to its library and reports every entry at offset `0`. The
  port reports no offset either, because where a file's bytes stand in the cabinet depends on the folder
  and on the compression of it; what the entry hands over is the unfolded bytes, and the entry is marked
  `compressed`.
* The reference names the type of an entry from its catalogue by the name of the file
  (`FormatCatalog.Instance.GetTypeFromName`). That catalogue is not carried here, so no type is named, as
  with the other archives of this project.
* The table of folders must stand inside the cabinet for the port to read it, and a record whose folder
  number is past the count of folders is turned away. The reference would leave both to its library.
* A cabinet that stands inside another archive is refused, as the reference refuses it
  (`VFS.IsVirtual`).
* The port reads one cabinet of a set at a time. A file that continues across the parts of a set is handed
  over as the part its own cabinet holds rather than joined with the parts beside it.

## Verification

Ten fixtures in `tests/formats/microsoft-cab-archive.test.ts` cover a folder of no compression with a
nested name, a folder of MSZIP whose second block reaches back into the window of the first, two folders
of different compressions, a head with a reserved room and with the names of both neighbours, a file that
continues into the next cabinet, and the refusals: a folder of LZX (listed, then refused on extraction), a
block without its `CK` letters, a block that unfolds to a length it does not name, a file that stands
outside its folder, and a stream that is no cabinet at all.

The MSZIP fixture is built so that the window matters. Its folder holds two blocks of the same thirty two
thousand places, so the deflate of the second block reaches back into the window the first one left behind;
the test asserts that inflating that block **without** a dictionary throws, and then that the port hands
the whole sixty four thousand places over unchanged. A reader that ignored the window could not pass both.

Beyond the fixtures the port was checked against a real cabinet of Windows:
`C:\Windows\appcompat\appraiser\Appraiser_AlternateData.cab`, a cabinet of one folder of MSZIP with ninety
eight blocks and four files, 2 861 922 bytes long. Its four entries were extracted with this port and
compared byte for byte with what the system's own `expand.exe` writes out of the same cabinet — 2 818 709
bytes of `appraiser.sdb` (SHA-256 `ce818b58d46818ce1f91b3297ea5feb060ec29fe7694a5f095d002906f05f110`),
114 926 of `backup.sdb` (`7a2fd606bc29b19bc0a9281fe81ab89ab236b660da281ea196b02371386c706c`), 147 521 of
`Appraiser_Data.ini` (`2df709acb74d21fa9df2d8f8437e066e144f936dd7472fcc5ad5eb7968fcf8e8`) and 113 321 of
`Appraiser_TelemetryRunList.xml`
(`d02f98adb13d888f74cd1dd22d8e2cef68a2af263c2ac9cad3736c644d685ce7`) — every one of them equal. That
cross-check is what found the file table walk this note describes: the first version of the reader assumed
a run of records behind a run of names, and read the names of the real cabinet as rubbish.

Two cabinets of LZX of Windows were walked with the port's own reading of the head as well, since they are
the cabinets a reader of that compression would have to be checked against:
`C:\Windows\servicing\FodMetadata\FoDMetadata_Client.cab` (500 948 bytes, one folder of one hundred and
twenty blocks reading `0x0f03`, and 455 files, the first of them `Accessibility.Braille~~1.0.mum` of 8 676
bytes) and `C:\Windows\Logs\CBS\CbsPersist_20260918195836.cab` (231 602 bytes, one folder of four
hundred and ninety three blocks reading `0x1503`, and one file, `CbsPersist_20260918195836.log`). The
table of folders of the first stands sixty bytes in, behind the twenty bytes of room the head reserves, and
the walk of its blocks from the place it names ends **exactly** at the end of the cabinet; the blocks of the
second unfold to 16 151 848 bytes, which is exactly what `expand.exe` writes out of it, while the single
file of it declares 16 151 336 bytes — five hundred and twelve fewer than the blocks of its folder hold.
The port hands the declared length of the file over, as the reference's own library would, and the reading
of the whole folder is what a reader of LZX would be checked against.
