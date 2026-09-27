# Project status

A one page, human readable snapshot of how far this port has come against the GARbro baseline. The per row
truth lives in [`support-status.json`](support-status.json) (one record per row, machine readable) and the live
numbers come from `scripts/garbro-gap.mjs`; this file only rolls them up, so treat it as a summary and
regenerate it when the numbers move.

`support-status.json` schema version 2 adds an optional `readStatus` plus taxonomy-backed `gaps`. Migration is
incremental: the ten records touched by this work receive the structured fields, while the legacy prose fields
stay available to existing consumers. Run `pnpm support:check` before regenerating the TypeScript catalogue.

Written at commit `79ce8f01` (2026-09-28). Regenerate the numbers with:

```bash
node scripts/garbro-gap.mjs          # the totals line, plus the largest rows still pending
node scripts/garbro-gap.mjs --all    # every row that is not started
pnpm format && node scripts/generate-format-support.mjs   # refresh support.generated.ts after a record change
```

## Totals

| Measure | Count |
| --- | ---: |
| Rows in the baseline inventory (`docs/garbro-inventory.json`) | 1132 |
| Rows in the gap report (inventory minus the three unusable template drafts) | 1129 |
| `verified` | **0** |
| `partial` | 1086 |
| `in-progress` | 0 |
| `not-started` | 43 |

Two of those numbers need a word of explanation.

* **1132 versus 1129.** The inventory counts every exported GARbro implementation. Three of them are the
  template drafts `ArcFormats/DraftArc.cs`, `ArcFormats/DraftAudio.cs` and `ArcFormats/DraftImage.cs`: their
  class names carry question marks in place of a real name, their tag reads as `xxx`, and nothing can reach
  them. `garbro-gap.mjs` leaves them out of the report on purpose, so it works with 1129 rows.
* **Zero `verified`.** 1081 of the 1086 partial rows name *real-game differential output* as their remaining
  verification: the port is checked against synthetic fixtures, format specifications and independent
  implementations, but not against real game archives, because none are available in this environment. The
  `verified` status is reserved for that differential evidence, so it cannot be reached here. See
  [`test-data-targets.md`](test-data-targets.md) for the samples that would unlock it.

Real-game verification is intentionally **community-driven and demand-led**. The project does not intend to
acquire every title in the target list before the readers are useful, nor does a row waiting for a real sample
block unrelated work or ordinary use. When someone actually uses a reader and finds that a release, encryption
scheme or decoded output differs from the documented behavior, that report supplies both evidence of demand and
a concrete compatibility target. A focused issue can then drive the matching fixture, GARbro differential and
fix. Formats that nobody encounters may remain without real-game differential evidence; that means only that
their compatibility has not received that level of confirmation, not that already tested behavior is withheld.
The contribution and copyright boundaries for such reports are described in
[`test-data-targets.md`](test-data-targets.md#community-driven-verification).

Most records also list *archive creation* or *image encoding* as unsupported. That is a scope boundary, not a
defect: GARbro marks most readers `CanWrite => false` as well, and this project is a reading port
(`create: false`). The sections below look only at reading.

## The 43 rows that are not started

| Cause | Rows | Examples |
| --- | ---: | --- |
| The key or scheme is not in the file (GARbro asks the user, or ships an empty `KnownKeys` table) | ~25 | `PKZ`, `PKG/2`, `ADS`, `PBZ`, `ARC/FOMA`, `CG/ACTGS`, `PCK/TAMAMO`, `ACV`, `DAT/MINATO`, `ARC/noncolor`, `NPK`, `YPF`, `PAZ`, `DAT/RepiPack`, `DPK`, `DXA`, `LIBP`, `OGG/TINK`, `CRZ`, `PAK/MORNING` |
| The reference itself is a stub that reads nothing, or does not compile | 7 | `MCP`, `LPC`, `AF2`, `BIN/DXLIB`, `EMS`, `WBC` |
| The reference hands the payload to a platform library or a third party library | 4 | `WMA` (NAudio/Media Foundation), `OPUS` (Opus library) |
| The data lives outside the file | 4 | `DAT/IGS` (an SQLite database beside the archive), `DAT/hibiki`, `BYTES/UNITY`, `DAT/GX4LIB` (a .NET `BinaryFormatter` graph) |
| Nothing to lay out: inert registry entries of the reference | 4 | `SCR`, `TXT`, `DAT/GENERIC`, `AMP/LEAF` |
| A listing file the reference does not ship | 2 | `MBM`, `PACK/BONK` (`*.lst` listings) |

`MCP` is worth naming: `Legacy/Mink/ImageMCP.cs` is a draft, not an implementation. The class is called
`xxxFormat`, `ReadMetaData` stops inside an object initializer, and `Read` returns
`ImageData.Create (info, format, palette, pixels)` where none of the three is declared — there is no palette
walk and no pixel walk to port. The audio stubs are the same story: `EMS` and `WBC` do not even compile.

The rows *not* named above are the ones a from-spec walk could carry without a key: the platform-codec rows
(`OPUS`; Vorbis behind `OGG/TINK` is the same situation, though its keys are missing as well). WebP and TIFF
stood in that family and **are ported now**, from their published formats rather than from the library GARbro
calls.

## Real functional gaps inside the ported rows

These are rows where GARbro has a working, self contained implementation of something this port does not do
yet. They are the honest work list, roughly in the order I would take them.

**1. Entry typing through the format catalogue (39 explicitly recorded rows remain).** GARbro's
`GameRes/FormatCatalog.cs` maps an entry extension and an entry signature to a format tag (`LookupExtension`,
`LookupSignature`). The shared infrastructure now generates those maps from all 1132 inventory rows, applies
GARbro's aliases and rejects ambiguous signatures. `ags-dat` and `ast-arc` are the extension-lookup pilots;
`dogenzaka-bin`, `dogenzaka-bin-2` and `elf-vol` are the signature-lookup pilots. The remaining records include
`artemis-pfs`, `g2-pak`, `ail-dat` and `ddsystem-ddp2`; they can now adopt the shared classifier without adding
another format table.

**2. Image payload decoding (~59 rows).** The archive is read, the payload is a picture, and the reference
decodes it while this port hands the stored surface over. One query over the records (any unsupported item
that mentions decoding, unpacking or decompression, minus the audio ones and minus the rows that say the
reference itself hands the stream to its platform) gives 59 rows:
`gamesystem-chr`, `lilim-abm`, `origin-dat-hed`, `speed-arc`, `valkyria-odn`, `splush-wave-flk`,
`reallive-g00`, `ikura-gan`, `emon-eme`, `fvp-hzc-multi`, `ebgsystem-bin`, `hexenhaus-wag`, `csware-dat`,
`g2-pak`, `gamesystem-dat`, `lune-pack`, `witch-pcd`, `parsley-cg-v1`, `mangagamer-mgpk0`, `alicesoft-afa`,
`webp-image` and others.

Some of those need nothing new, because the reader already exists in the project:

* `webp-image` (the `ArcFormats/WebP` row) now uses the same lossless, lossy and alpha reader as the
  `Experimental/WebP` row (`gameres-webp-image`) and writes the decoded picture as a 32-bit bitmap.
* `hexenhaus-wag` now decrypts its IMGD entries and passes them to the existing IMGD/PNG reader, producing
  24-bit or 32-bit bitmaps. The stale *png validation* limitations of `psm-image`, `xuse-p4ag-image` and
  `zenos-pnx-image` have also been removed: all three already reconstruct, validate and decode the complete
  PNG through the shared reader.
* `palette-pga-image` and `malie-mgf-image` stood in this family until this week and **are fixed now**: both
  decode their PNG payload into a bitmap, which is what `PgaFormat : PngFormat` and `MgfFormat : PngFormat` do.

Ten further rows name a picture the reference itself hands to its platform decoder (WPF, or the codec of the
system) — `alicesoft-ajp-image`, `black-cyc-dwq-image`, `crowd-cwp-image`, `ivory-sg-image`, `leaf-pak`,
`macromedia-swf-archive`, `macromedia-dxr-archive`, `mng-image`, `palette-chr`, `topcat-spd-image`. Those are
outside an alignment against GARbro's own algorithms unless a published format is worth implementing, the way
WebP and TIFF were.

**3. Audio payload decoding (24 rows).** `ogg decoding` (11), `mp3 decoding` (2), `audio decoding` (3),
`image and audio decoding` (5) and a few singletons. GARbro delegates these too (`NVorbis` for Ogg,
`NAudio.Wave.Mp3FileReader` for MP3), so they share the platform-codec caveat; Vorbis is the one a from-spec
walk could carry.

**4. Variants inside a single format.** Each of these is a small, self contained piece of the reference that
the port does not walk yet:

* `livemaker-gal-image`, `livemaker-galx-*`: the key comes from the engine state rather than from the picture
  head, the frames after the first are not read, and a JPEG variant is unread.
* `softpal-pgd-image`, `softpal-pgd-ge-image`, `softpal-pgd00-image`, `softpal-pgd11-image`: the layer walk
  inside PGD.
* `adviz-biz-image`, `adviz-giz2-image`: a palette that stands in a palette table beside the picture rather
  than inside it.
* `artemis-pfs`: an alternate UTF-8 name encoding.
* `mng`: the PNG interchange reader of this project turns some of its frames away.
* `cyberworks-csystem-dat` and neighbours: image decryption schemes (only if the scheme is derivable from the
  file; the records currently say it is not).

**5. Write side (not a parsing gap).** 55 rows name *audio encoding*, 33 *image writing*, 20 *picture
creation*, 18 *image creation*, and so on. GARbro implements writing for some formats; this port does not, by
design. Aligning writing would be a separate workstream.

## Documentation drift to clean up

* `docs/support.md` quotes the inventory count (1132) without mentioning that the gap report works from 1129
  rows, which reads like a contradiction. It has been given a note.
* `docs/deferred-formats.md` is the reference for *why* a row is not started, and its reasoning still holds,
  but its running counts froze at 1084 ported / 45 unported (now 1086 / 43) and one of its family paragraphs
  claimed the "surface handed over as the file holds it" family complete. That wording is gone from the
  records, but the same behaviour still stands under other wordings — see gap 2 above.

## Suggested order of work

1. Establish the community-driven real-game verification policy and issue guidance, without making sample
   acquisition a release gate.
2. Extend the now-shared entry catalogue classifier to the 39 records that still name this gap.
3. Then the per format variants in gap 4, and the from-spec codecs (Vorbis, and whatever gap 2 turns out to
   need).
