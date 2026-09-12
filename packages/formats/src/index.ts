import { FormatRegistry } from "@garbro-mcp/core";
import { Adpack32Format } from "./active-soft/adpack32.js";
import { AmiFormat } from "./amaterasu/ami.js";
import { GspFormat } from "./black-rainbow/gsp.js";
import { IntFormat } from "./cat-system/int.js";
import { AfsFormat } from "./cri/afs.js";
import { CpkFormat } from "./cri/cpk.js";
import { BgiArcFormat, BurikoArcFormat } from "./ethornell/arc.js";
import { EscudeBinFormat } from "./escude/bin.js";
import { AcpxFormat } from "./favorite/acpx.js";
import { FavoriteBinFormat } from "./favorite/bin.js";
import { DrsFormat } from "./ikura/drs.js";
import { MpxFormat } from "./ikura/mpx.js";
import { Xp3Format } from "./xp3/format.js";

export * from "./active-soft/index.js";
export * from "./amaterasu/index.js";
export * from "./black-rainbow/index.js";
export * from "./cat-system/index.js";
export * from "./cri/index.js";
export * from "./ethornell/index.js";
export * from "./escude/index.js";
export * from "./favorite/index.js";
export * from "./ikura/index.js";
export * from "./xp3/index.js";

export function createDefaultRegistry(): FormatRegistry {
	return new FormatRegistry([
		new Xp3Format(),
		new Adpack32Format(),
		new AfsFormat(),
		new CpkFormat(),
		new AmiFormat(),
		new BgiArcFormat(),
		new BurikoArcFormat(),
		new DrsFormat(),
		new MpxFormat(),
		new EscudeBinFormat(),
		new GspFormat(),
		new IntFormat(),
		new AcpxFormat(),
		new FavoriteBinFormat(),
	]);
}
