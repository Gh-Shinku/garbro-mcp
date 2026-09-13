# Valkyria engine ODN resource archive

Reference: `GARbro/ArcFormats/Valkyria/ArcODN.cs`, classes `OdnOpener` and `OdnIndexReader` (the
image decoder and the `.pni` scheme INI are out of scope)
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/valkyria/odn.ts` (`valkyriaOdnDescriptor`,
`valkyriaOdnFormat`, id `valkyria-odn`).

The format has no signature; like the reference it only opens files with the `odn`, `dat` or `pni`
extension and then proves itself by parsing the index.

## Layout dispatch

The first `0x1C` bytes are read once and decide which of three layouts follows:

| Test | Layout |
|------|--------|
| offset field (`8..16`) is `00000000` | version one, relative offsets |
| the first `0x10` bytes are printable ASCII | version two, record size `0x10` or `0x18` |
| otherwise | masked index, unmasked with a key counting down from `0xFF` over the first `0x10` bytes |

The version two test also reads the four characters at the record size and compares them with the
first four characters of the record. The masked layout is only accepted when the unmasked header
shows the `00000000` offset field of the first layout.

## Index records

A record is a text block: an eight character name, an eight character hexadecimal offset, and — for
the `0x18` version two record — eight more characters. Offsets larger than the file are declined
instead of raising the reference's `InvalidFormatException`.

**Version one.** Records are `0x10` bytes and the list ends at `END_ffffffffffff` (scripts stay
masked), at `ffffffffffffffff` (scripts are stored as they are), or at `HIME_END`, which also skips
eight more bytes. Record offsets are relative to the end of the index, and a trailing entry that
starts exactly at the end of the file is dropped.

**Version two.** The first record's offset bounds the index: records are read while the cursor stays
below it, and a record whose offset is the end of the file ends the list without being added.
Offsets are absolute.

**Masked.** The first record was already unmasked by the dispatch; each following record is masked
with the running key, and the list ends at `ffffffffffffffff`. Record offsets are relative to the end
of the index, which includes the terminator record.

## Types and sizes

Sizes follow the entry order: every entry ends where the next one starts, and the last one ends at
the end of the file. The type comes from the name or from the payload:

| Test | Type |
|------|------|
| `^(back|phii|psss)` | image |
| `^(scrp|menu|sysm)` | script, masked unless the index turned that off |
| `^hime` | audio |
| payload signature `0x5E6A6A42` | audio, masked |
| payload signature `RIFF` (`0x46464952`) | audio |
| `AutoEntry.DetectFileType` equivalent | detected type |
| `^(data|codn|cccc|fund|puni|wind)` | image, when nothing else matched |

## Extraction

* **Masked scripts** are unmasked with the complement of the entry offset used as the countdown key:
  `data[i] ^= key; key -= 1` starting from `~offset & 0xFF`.
* **Audio entries** (`^hime`) are raw PCM: a 44 byte RIFF/WAVE header for 16 bit mono PCM is
  prepended. GARbro exposes `22050` and `44100` as a user setting; the port fixes the rate at
  `44100`.
* **Masked Ogg payloads** (`0x5E6A6A42`, which is `OggS` masked with `0x0D`) are unmasked with that
  constant key, the same stream the reference wraps in `XoredStream`.
* Everything else is extracted verbatim.

## Deviations

* The image decoder (`UnpackImage`, `OdnImageDecoder`) and the `ValkScheme` INI reader for the `.pni`
  companion are out of scope.
* The audio sample rate is a fixed `44100` instead of the reference's user setting.
* Entry offset and size ranges are checked against the file so a malformed index declines, and the
  entry count is capped at `0x40000` so a record list that never reaches its terminator stops
  instead of running away.
* Archive creation is out of scope.
