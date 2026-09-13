# NScripter engine script

Reference: `GARbro/ArcFormats/NScripter/Script.cs`, class `NSOpener`
(GARbro commit `b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0`, MIT).

Implementation: `packages/formats/src/nscripter/script.ts` (`nsOpenerDescriptor`, `nsOpenerFormat`,
id `nscripter-script`).

A script resource rather than an archive. There is no signature: `IsScript` only compares the file
name to `nscript.dat` (case insensitively), and both `ConvertFrom` and `ConvertBack` are the same
`XoredStream` call, so the mask is its own inverse: every byte of the file is exclusive-ored with
`0x84`. Unmasking the file yields the plain NScripter script text.

The port exposes the resource as a single entry:

* detection needs a non empty file whose base name is `nscript.dat`, in any case (the non empty check
  is a safety deviation; the reference does not read the file at all);
* the entry is named after the source file with a `txt` extension and covers the whole file;
* the mask preserves the length, so `sizeKnown` stays true and the entry is flagged encrypted;
* extraction unmasks every byte with the same key;
* entry metadata carries `type: "script"` and the archive metadata records `script: "nscripter"` and
  the key.

The reverse conversion (writing a masked script back) and archive creation are out of scope.
