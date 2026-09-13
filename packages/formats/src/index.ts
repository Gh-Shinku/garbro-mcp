import { FormatRegistry } from "@garbro-mcp/core";
export { formatSupportCatalog } from "./support.generated.js";
import { advSysFpkFormat } from "./advsys/fpk.js";
import { Adpack32Format } from "./active-soft/adpack32.js";
import { bananaPkFormat } from "./banana/pk.js";
import { ailDatFormat, lnk2Format } from "./ail/dat.js";
import { AmiFormat } from "./amaterasu/ami.js";
import { mjaFormat } from "./artemis/mja.js";
import { mifFormat } from "./basil/mif.js";
import { bishopBscFormat } from "./bishop/bsc.js";
import { bishopPkFormat } from "./bishop/pk.js";
import { dpfFormat } from "./mutation/dpf.js";
import { ccfFormat } from "./black-rainbow/ccf.js";
import { circusPckFormat } from "./circus/pck.js";
import { GspFormat } from "./black-rainbow/gsp.js";
import { abelBinFormat } from "./abel/bin.js";
import { antiqueDatFormat } from "./antique/dat.js";
import { gpk2Format } from "./gpk2/gpk2.js";
import { kaasPbFormat } from "./kaas/pb.js";
import { kpcFormat } from "./kscript/kpc.js";
import { clioPacFormat } from "./clio/pac.js";
import { IntFormat } from "./cat-system/int.js";
import { AfsFormat } from "./cri/afs.js";
import { CpkFormat } from "./cri/cpk.js";
import { spcFormat } from "./cri/spc.js";
import { BgiArcFormat, BurikoArcFormat } from "./ethornell/arc.js";
import { EscudeBinFormat } from "./escude/bin.js";
import { AcpxFormat } from "./favorite/acpx.js";
import { FavoriteBinFormat } from "./favorite/bin.js";
import { mrg0Format } from "./fc01/mrg0.js";
import { fpk2Format } from "./interheart/fpk2.js";
import { irrlichtPackFormat } from "./irrlicht/pack.js";
import { HyPackFormat } from "./hypatia/hypack.js";
import { dallPelFormat } from "./dall/pel.js";
import { DrsFormat } from "./ikura/drs.js";
import { MpxFormat } from "./ikura/mpx.js";
import { ivorySgFormat } from "./ivory/sg.js";
import { k5Format } from "./gsx/k5.js";
import { flkFormat } from "./liddell/flk.js";
import { leafPxFormat } from "./leaf/px.js";
import { leafTexFormat } from "./leaf/tex.js";
import { museDatFormat } from "./muse/dat.js";
import { MajiroArcFormat } from "./majiro/arc.js";
import { shaFormat } from "./mg/sha.js";
import { gsdFormat } from "./microvision/gsd.js";
import { NekoPack1Format } from "./nekopack/v1.js";
import { NekoPack2Format } from "./nekopack/v2.js";
import { NekoPack3Format } from "./nekopack/v3.js";
import { LstFormat } from "./nexton/lst.js";
import { oneUpArcFormat } from "./oneup/arc.js";
import { unaDatFormat } from "./myharvest/dat.js";
import { mpkFormat } from "./nitroplus/mpk.js";
import { nppFormat } from "./nitroplus/npp.js";
import { parsleyScnFormat } from "./parsley/scn.js";
import { plantechPacFormat } from "./plantech/pac.js";
import { phsFormat } from "./uran/phs.js";
import { redzonePakFormat } from "./redzone/pak.js";
import { pinesoftVoiceFormat } from "./pinesoft/voice.js";
import { parsleyPacFormat } from "./parsley/pac.js";
import { kissArcFormat } from "./kiss/arc.js";
import { KcapFormat } from "./selene/kcap.js";
import { seraphimMcFormat } from "./seraphim/mc.js";
import { ivoryPxFormat } from "./ivory/px.js";
import { silkyArcFormat } from "./silky/arc.js";
import { silkyMfgFormat } from "./silky/mfg.js";
import { vsdFormat } from "./silky/vsd.js";
import { succubusArcFormat } from "./succubus/arc.js";
import { tailPkgFormat } from "./tail/pkg.js";
import { tanakaArc0Format } from "./tanaka/arc0.js";
import { tanakaWvxFormat } from "./tanaka/wvx.js";
import { dpkFormat } from "./sysd/dpk.js";
import { PackDatFormat } from "./system-epsilon/packdat.js";
import { sudFormat } from "./triangle/sud.js";
import { p8Format } from "./tinkerbell/p8.js";
import { ukFormat } from "./ucom/uk.js";
import { valkyriaAm2Format } from "./valkyria/am2.js";
import { valkyriaDatFormat } from "./valkyria/dat.js";
import { ifxFormat } from "./winters/ifx.js";
import { pkdFormat } from "./zone/pkd.js";
import { Xp3Format } from "./xp3/format.js";
import { alkFormat } from "./alicesoft/alk.js";
import { cdpaPackFormat } from "./cdpa/pack.js";
import { hyperworksPakFormat } from "./hyperworks/pak.js";
import { nafFormat } from "./brownie/naf.js";
import { cpaFormat } from "./aquarium/cpa.js";
import { sceplayPakFormat } from "./sceplay/pak.js";
import { tigermanPacFormat } from "./tigerman/pac.js";
import { irisFpackFormat } from "./iris/fpack.js";
import { herbPakFormat } from "./herb/pak.js";
import { applePieArcFormat } from "./applepie/arc.js";
import { pfdFormat } from "./artel/pfd.js";
import { radFormat } from "./rsystem/rad.js";
import { k3Format } from "./gsx/k3.js";
import { aqaFormat } from "./unknown/aqa.js";
import { weaponVoiceFormat } from "./weapon/voice.js";
import { palettePakFormat } from "./palette/pak.js";
import { ml2Format } from "./mina/ml2.js";
import { vbdFormat } from "./witch/vbd.js";
import { lpkFormat } from "./hypatia/lpk.js";
import { ipacFormat } from "./ipac/pak.js";
import { bldFormat } from "./bellda/dat.js";
import { nscFormat } from "./nekotaro/nsc.js";
import { taskforceDatFormat } from "./taskforce/dat.js";
import { alphaSystemPakFormat } from "./alpha-system/pak.js";
import { szsFormat } from "./slg/szs.js";
import { capybaraDatFormat } from "./winters/capybara.js";
import { mykFormat } from "./cherry/myk.js";
import { arcxFormat } from "./arcx/arc.js";
import { sdaFormat } from "./mmfass/sda.js";
import { bmxFormat } from "./tanaka/bmx.js";
import { dnsFormat } from "./marble/dns.js";
import { panFormat } from "./pan/pan.js";
import { dsvFormat } from "./desire/dsv.js";
import { karFormat } from "./cadath/kar.js";
import { asuraPakFormat } from "./asura/pak.js";
import { pak2Format } from "./palette/pak2.js";
import { snnFormat } from "./blue-gale/snn.js";
import { vpkFormat } from "./black-cyc/vpk.js";
import { bndFormat } from "./tetratech/bnd.js";
import { aosDatFormat } from "./aos/dat.js";
import { keroqDatFormat } from "./keroq/dat.js";
import { bcdFormat } from "./ransel/bcd.js";
import { zipFormat } from "./pkware/zip.js";
import { aimsPackFormat } from "./aims/pack.js";
import { cfpFormat } from "./winters/cfp.js";
import { aryFormat } from "./pearl/ary.js";
import { akatomboXFormat } from "./akatombo/x.js";
import { crgFormat } from "./rhss/crg.js";
import { abelFpkFormat } from "./abel/fpk.js";
import { clsFormat } from "./lambda/cls.js";
import { ffaFormat } from "./ffa/arc.js";
import { pogFormat } from "./ads/pog.js";
import { irrlichtArkFormat } from "./irrlicht/ark.js";
import { fl2Format } from "./aaru/fl2.js";
import { fl3Format } from "./aaru/fl2.js";
import { gscripterDataFormat } from "./gscripter/data.js";
import { chrFormat } from "./tigerman/chr.js";
import { witchArcFormat } from "./witch/arc.js";
import { typesArcFormat } from "./types/arc.js";
import { gdFormat } from "./xuse/gd.js";
import { aapFormat } from "./aquarium/aap.js";
import { mirisDatFormat } from "./eternity/miris.js";
import { cdtFormat } from "./uma/cdt.js";
import { usfFormat } from "./westgate/usf.js";
import { iafFormat } from "./triangle/iaf.js";
import { lwgFormat } from "./liar/lwg.js";
import { paqFormat } from "./force/paq.js";
import { triangleDatFormat } from "./triangle/dat.js";
import { rpmArcFormat } from "./rpm/arc.js";
import { rpmZenosFormat } from "./rpm/zenos.js";
import { cabFormat } from "./entexec/cab.js";
import { glnkFormat } from "./eternity/glnk.js";
import { advdxPkdFormat } from "./advdx/pkd.js";
import { dmotionPackFormat } from "./dmotion/pack.js";
import { ovkFormat } from "./reallive/ovk.js";
import { propellerMpkFormat } from "./propeller/mpk.js";
import { tcd1Format } from "./topcat/tcd1.js";
import { odioFormat } from "./hexenhaus/odio.js";
import { nfsFormat } from "./nags/nfs.js";
import { xpkFormat } from "./kirikiri/xpk.js";
import { xuseBinFormat } from "./xuse/bin.js";
import { mbfFormat } from "./tanaka/mbf.js";
import { blackRainbowDatFormat } from "./black-rainbow/dat.js";
import { iksFormat } from "./xiks/iks.js";
import { fgFormat } from "./frontwing/fg.js";
import { cp3Format } from "./seraphim/cp3.js";
import { crmFormat } from "./circus/crm.js";
import { pkgFormat } from "./yatagarasu/pkg.js";
import { gpkFormat } from "./black-cyc/gpk.js";
import { arc0Format } from "./mixwill/arc0.js";
import { minkGrpFormat } from "./mink/grp.js";
import { yaneDatFormat } from "./yane-sdk/dat.js";
import { s25Format } from "./shiina-rio/s25.js";
import { hg2Format } from "./cat-system/hg2.js";
import { hg3Format } from "./cat-system/hg3.js";
import { patisserieRawFormat } from "./patisserie/raw.js";
import { tanakaVpkFormat } from "./tanaka/vpk.js";
import { ifpFormat } from "./winters/ifp.js";
import { xarcFormat } from "./xuse/xarc.js";
import { dafFormat } from "./cadath/daf.js";
import { hotFormat } from "./hdl/hot.js";
import { advSys3Format } from "./advsys/arc3.js";
import { neonAr2Format } from "./neon/ar2.js";
import { kasaneAr2Format } from "./kasane/ar2.js";
import { witchDatFormat } from "./witch/dat.js";
import { mnvFormat } from "./mno-violet/dat.js";
import { umpkFormat } from "./umut/pak.js";
import { airyuChrFormat } from "./airyu/chr.js";
import { animFormat } from "./marble/anim.js";
import { pochettePacFormat } from "./pochette/pac.js";
import { cgdFormat } from "./kapp/cgd.js";
import { ucomDataFormat } from "./ucom/data.js";
import { ai5DatFormat } from "./elf/ai5dat.js";
import { awfFormat } from "./silky/awf.js";
import { mgdFormat } from "./masys/mgd.js";
import { wvbFormat } from "./xuse/wvb.js";
import { pcdFormat } from "./nejii/pcd.js";
import { aldFormat } from "./alicesoft/ald.js";
import { yaneSdaFormat } from "./yaneurao/sda.js";
import { gameDatFormat } from "./pajamas/gamedat.js";
import { pmxFormat } from "./sceneplayer/pmx.js";
import { pmaFormat } from "./sceneplayer/pma.js";
import { gr2Format } from "./umesoft/gr2.js";
import { spdFormat } from "./slg/spd.js";
import { electriciteitDatFormat } from "./electriciteit/dat.js";
import { dskFormat } from "./abogado/dsk.js";
import { pkDatFormat } from "./paprika/pkdat.js";
import { plaFormat } from "./squadrad/pla.js";
import { cpnFormat } from "./marron/cpn.js";
import { mcdFormat } from "./tsd/mcd.js";
import { igaFormat } from "./noesis/iga.js";
import { djDatFormat } from "./djsystem/dat.js";
import { cpz1Format } from "./cmvs/cpz1.js";
import { arc2Format } from "./csware/arc2.js";
import { yuFormat } from "./tactics/yu.js";
import { gxpFormat } from "./astronauts/gxp.js";
import { c24Format } from "./foster/c24.js";
import { c25Format } from "./foster/c24.js";
import { lb5Format } from "./jupiter/lb5.js";
import { cgV2Format } from "./parsley/cg2.js";
import { ykFormat } from "./rune/yk.js";
import { ucgFormat } from "./parsley/ucg.js";
import { voiceFormat } from "./seraphim/voice.js";
import { arccFormat } from "./hexenhaus/arcc.js";
import { sdaSdFormat } from "./squadrad/sda.js";
import { sqzFormat } from "./musica/sqz.js";
import { mpkHgFormat } from "./tako/mpk.js";
import { tanFormat } from "./ikura/tan.js";
import { csPackFormat } from "./cat-system/cspack.js";
import { cpcFormat } from "./broom/cpc.js";
import { airFormat } from "./adobe/air.js";
import { gafFormat } from "./origin/gaf.js";
import { emicFormat } from "./emic/pack.js";
import { ipqFormat } from "./techno-brain/ipq.js";
import { aniFormat } from "./musica/ani.js";
import { microVisionArcFormat } from "./microvision/arc.js";
import { dxFormat } from "./black-rainbow/dx.js";
import { smvFormat } from "./tanaka/smv.js";
import { cgfFormat } from "./triangle/cgf.js";
import { techgianBinFormat } from "./techgian/bin.js";
import { speedArcFormat } from "./speed/arc.js";
import { hzcMultiFormat } from "./favorite/hzc-multi.js";
import { lunaPacFormat } from "./luna-soft/pac.js";
import { fgaFormat } from "./lilim/fga.js";
import { aos2Format } from "./lilim/aos2.js";
import { aosFormat } from "./lilim/aos.js";
import { azuriteFormat } from "./silky/azurite.js";
import { ai6WinFormat } from "./silky/ai6win.js";
import { nekopunchPakFormat } from "./nekopunch/pak.js";
import { mugiBinFormat } from "./mugi/bin.js";
import { crowdPckFormat } from "./crowd/pck.js";
import { dlbFormat } from "./aypio/dlb.js";
import { dlbV0Format } from "./aypio/dlb.js";
import { ttdFormat } from "./melonpan/ttd.js";
import { gxFormat } from "./scoop/gx.js";
import { dl1Format } from "./csware/dl1.js";
import { nejiiCdtFormat } from "./nejii/cdt.js";
import { rainBinFormat } from "./rain/bin.js";
import { aarFormat } from "./alicesoft/aar.js";
import { ucaFormat } from "./westgate/uca.js";
import { uwfFormat } from "./westgate/uwf.js";
import { spackFormat } from "./spack/dat.js";
import { pkkFormat } from "./electriciteit/pkk.js";
import { jamDatFormat } from "./jam-creation/dat.js";
import { adsPacFormat } from "./ads/pac.js";
import { bsaFormat } from "./bishop/bsa.js";
import { ivoryPkFormat } from "./ivory/pk.js";
import { omiDatFormat } from "./omi/dat.js";
import { system21PakFormat } from "./system21/pak.js";
import { isaFormat } from "./ism/isa.js";
import { circusDatFormat } from "./circus/dat.js";
import { mgxFormat } from "./ume-soft/mgx.js";
import { broomPkFormat } from "./broom/pk.js";
import { broomEncryptedPkFormat } from "./broom/pk.js";
import { softpalPacFormat } from "./softpal/pac.js";
import { amusePacFormat } from "./softpal/pac.js";
import { scrPlayerPakFormat } from "./scrplayer/pak.js";
import { maiFormat } from "./mai/arc.js";
import { arFormat } from "./palm-tree/ar.js";
import { a98Format } from "./active-soft/a98.js";
import { wbpFormat } from "./wild-bug/wbp.js";
import { kaguyaPltFormat } from "./kaguya/plt.js";
import { kaguyaPl10Format } from "./kaguya/pl10.js";
import { kaguyaAn21Format } from "./kaguya/an21.js";
import { nscripterSarFormat } from "./nscripter/sar.js";
import { keyPakFormat } from "./key/pak.js";
import { egoDatFormat } from "./studio-ego/ego-dat.js";
import { egoOldDatFormat } from "./studio-ego/ego-dat.js";
import { him4Format } from "./shsystem/hxp.js";
import { him5Format } from "./shsystem/hxp.js";
import { ddp2Format } from "./dd-system/ddp.js";
import { ddp3Format } from "./dd-system/ddp.js";
import { gpcFormat } from "./eushully/gpc.js";
import { sndFormat } from "./eushully/gpc.js";
import { snrFormat } from "./eushully/gpc.js";
import { anmFormat } from "./kaguya/anm.js";
import { an10Format } from "./kaguya/anm.js";
import { an20Format } from "./kaguya/anm.js";
import { volFormat } from "./elf/vol.js";
import { vfsFormat } from "./aoi/vfs.js";
import { boxFormat } from "./aoi/box.js";
import { aoimyFormat } from "./aoi/box.js";
import { aoimyUnicodeFormat } from "./aoi/box.js";
import { mgpk0Format } from "./manga-gamer/mgpk0.js";
import { hedFormat } from "./elf/hed.js";
import { wsm0Format } from "./tanaka/wsm.js";
import { wsm1Format } from "./tanaka/wsm.js";
import { wsm2Format } from "./tanaka/wsm.js";
import { wsm4Format } from "./tanaka/wsm.js";
import { arcgFormat } from "./tanaka/arcg.js";
import { vcPakFormat } from "./circus/vc.js";
import { xflFormat } from "./liar/xfl.js";
import { exhGRPFormat } from "./ex-hibit/grp.js";
import { abmpFormat } from "./q-lie/abmp.js";
import { abmp7Format } from "./q-lie/abmp.js";
import { spPakFormat } from "./black-rainbow/sp.js";
import { meltyPakFormat } from "./black-rainbow/melty.js";
import { zlkFormat } from "./nyoken/zlk.js";
import { iflFormat } from "./silky/ifl.js";
import { libidoArcFormat } from "./libido/arc.js";
import { tlzFormat } from "./otemoto/tlz.js";
import { dmFormat } from "./digital-monkey/dm.js";
import { morningTtdFormat } from "./morning/ttd.js";
import { studioSakuraDatFormat } from "./studio-sakura/dat.js";
import { fwaFormat } from "./nug/fwa.js";
import { riddlePacFormat } from "./riddle/pac.js";
import { myAdvPacFormat } from "./myadv/pac.js";
import { maikaMik01Format } from "./maika/mik01.js";
import { pinpaiArcxFormat } from "./pinpai/arcx.js";
import { gigaTpfFormat } from "./giga/tpf.js";
import { sognaDatFormat } from "./sogna/dat.js";
import { diceRlzFormat } from "./dice/rlz.js";
import { sdtFormat } from "./uma/sdt.js";
import { unknownDatFormat } from "./unknown/dat.js";
import { yoxDatFormat } from "./yox/dat.js";
import { entisPacFormat } from "./entis/pac.js";
import { triangleBmxFormat } from "./triangle/bmx.js";
import { digitalWorksPacFormat } from "./digital-works/pac.js";
import { pspQpkFormat } from "./psp/qpk.js";
import { nitroplusPakFormat } from "./nitroplus/pak.js";
import { nekosdkDatFormat } from "./nekosdk/dat.js";
import { willWipFormat } from "./will/wip.js";
import { leafAFormat } from "./leaf/a.js";
import { seenFormat } from "./reallive/seen.js";
import { gamesystemDatFormat } from "./gamesystem/dat.js";
import { abelArcFormat } from "./abel/arc.js";
import { cpz2Format } from "./cmvs/cpz2.js";
import { cswareDatFormat } from "./csware/dat.js";
import { hcsystemPakFormat } from "./hcsystem/pak.js";
import { vnsystemVfsFormat } from "./vnsystem/vfs.js";
import { cromwellPakFormat } from "./cromwell/pak.js";
import { cromwellOpkFormat } from "./cromwell/opk.js";
import { propellerMgrFormat } from "./propeller/mgr.js";
import { sohfuSkaFormat } from "./sohfu/ska.js";
import { kaguyaUfFormat } from "./kaguya/uf.js";
import { umeSoftPkFormat } from "./ume-soft/pk.js";
import { archangelDatFormat } from "./seraphim/dat.js";
import { ebgSystemBinFormat } from "./ebg-system/bin.js";
import { alternaBinFormat } from "./alterna/bin.js";
import { ebisuEp1Format } from "./ebisu/ep1.js";
import { umeSoftBinFormat } from "./ume-soft/bin.js";
import { penguinPacFormat } from "./penguin/pac.js";
import { blueGaleAmvFormat } from "./blue-gale/amv.js";
import { clickTeamMfsFormat } from "./clickteam/mf.js";
import { miscBinFormat } from "./misc/bin.js";
import { ponytailBndFormat } from "./ponytail/bnd.js";
import { ankhGrpFormat } from "./ankh/grp.js";
import { ankhDatFormat } from "./ankh/dat.js";
import { shapeShifterBndFormat } from "./shapeshifter/bnd.js";
import { ffaDatFormat } from "./ffa/dat.js";
import { ffaJdatFormat } from "./ffa/dat.js";
import { malieLibuFormat } from "./malie/libu.js";
import { willPnaFormat } from "./will/pna.js";
import { yaneuraoDatDxFormat } from "./yaneurao/dat.js";
import { yaneuraoDatExFormat } from "./yaneurao/dat.js";
import { leafLacFormat } from "./leaf/lac.js";
import { leafLacPakFormat } from "./leaf/lac.js";
import { blackRainbowImpFormat } from "./black-rainbow/imp.js";
import { dogenzakaBinFormat } from "./dogenzaka/bin.js";
import { dogenzakaGameDatFormat } from "./dogenzaka/bin.js";
import { sophiaNorFormat } from "./sophia/nor.js";
import { maikaBkFormat } from "./maika/bk.js";
import { unisonVctFormat } from "./unison/vct.js";
import { factorResFormat } from "./factor/res.js";
import { nekoSdkPakFormat } from "./nekosdk/pak.js";
import { loggArfFormat } from "./logg/arf.js";
import { glibGFormat } from "./glib/g.js";
import { blackButterflyDatFormat } from "./black-butterfly/dat.js";
import { debonosuPakFormat } from "./debonosu/pak.js";
import { vnEngineAxrFormat } from "./vn-engine/axr.js";
import { animeGameSystemAniFormat } from "./anime-game-system/ani.js";
import { animeGameSystemDatFormat } from "./anime-game-system/dat.js";
import { maikaMk2Format } from "./maika/mk2.js";
import { astArcFormat } from "./ast/arc.js";
import { leafAr2Format } from "./leaf/ar2.js";
import { leafAmFormat } from "./leaf/am.js";
import { carriereArcFormat } from "./carriere/arc.js";
import { carriereScenarioFormat } from "./carriere/arc.js";
import { kaguyaLin2Format } from "./kaguya/lin2.js";
import { system98LibFormat } from "./system98/lib.js";
import { frontWingFltFormat } from "./frontwing/flt.js";
import { densdkDaf1Format } from "./densdk/daf.js";
import { densdkDaf2Format } from "./densdk/daf.js";
import { pfsFormat } from "./artemis/pfs.js";
import { tmrHiroPacFormat } from "./tmr-hiro/pac.js";
import { eushullyAlfFormat } from "./eushully/alf.js";
import { gamesystemCmpFormat } from "./gamesystem/cmp.js";
import { tamasoftEpkFormat } from "./tamasoft/epk.js";
import { youkaiDatGrpFormat } from "./youkai/dat.js";
import { youkaiDatSoundFormat } from "./youkai/dat.js";
import { youkaiDatVoiceFormat } from "./youkai/dat.js";
import { crowdPkwvFormat } from "./crowd/pck.js";
import { advscripterPakFormat } from "./advscripter/pak.js";
import { uranNclFormat } from "./uran/ncl.js";
import { apricotDatFormat } from "./apricot/dat.js";
import { cyberworksAppendixFormat } from "./cyberworks/appendix.js";
import { cyberworksDatFormat } from "./cyberworks/dat.js";
import { cyberworksCsystemDatFormat } from "./cyberworks/dat.js";
import { cyberworksCsystemDat2Format } from "./cyberworks/dat.js";
import { pandoraPbxFormat } from "./pandora/pbx.js";
import { nononoNpfFormat } from "./nonono/npf.js";
import { shiinaRioWarcFormat } from "./shiina-rio/warc.js";
import { realliveG00Format } from "./reallive/g00.js";
import { nitroplusNitroPakFormat } from "./nitroplus/nitro-pak.js";
import { systemAquaCatfFormat } from "./system-aqua/catf.js";
import { yukaYkcFormat } from "./yuka/ykc.js";
import { mokoProNnnnFormat } from "./moko-pro/nnnn.js";
import { eveGmFormat } from "./eve/gm.js";
import { studioEgoPak0Format } from "./studio-ego/pak0.js";
import { nexasPacFormat } from "./nexas/pac.js";
import { aaruFl4Format } from "./aaru/fl4.js";
import { wagFormat } from "./hexenhaus/wag.js";
import { mcaFormat } from "./fc01/mca.js";
import { dpmFormat } from "./hsp/dpm.js";
import { detFormat } from "./ugos/det.js";
import { pcdImageFormat } from "./witch/pcd.js";
import { daiPacFormat } from "./dai-system/pac.js";
import { ganFormat } from "./ikura/gan.js";
import { laxFormat } from "./lambda/lax.js";
import { fjsysFormat } from "./n-system/fjsys.js";
import { idaFormat } from "./inspire/ida.js";
import { ozFormat } from "./patisserie/bin.js";
import { fpkFormat } from "./interheart/fpk.js";
import { pcsFormat } from "./csware/pcs.js";
import { vavFormat } from "./frontwing/vav.js";
import { fa2Format } from "./foster/fa2.js";
import { cherryPakFormat } from "./cherry/pak.js";
import { cherryPak2Format } from "./cherry/pak.js";
import { grooverPcgFormat } from "./groover/pcg.js";
import { flkDatFormat } from "./splush-wave/flk.js";
import { asdKToolFormat } from "./kapp/asd.js";
import { asdSpielFormat } from "./kapp/asd.js";
import { kaguyaAriFormat } from "./kaguya/ari.js";
import { xuseBgFormat } from "./xuse/nt.js";
import { xuseHFormat } from "./xuse/nt.js";
import { xuseArcFormat } from "./xuse/miko.js";
import { xuseKotoriFormat } from "./xuse/miko.js";
import { lazycrewDatFormat } from "./lazycrew/dat.js";
import { parsleyDesertCgFormat } from "./parsley/cg3.js";
import { rareXFormat } from "./rare/x.js";
import { tailCafFormat } from "./tail/caf.js";
import { gameSystemChrFormat } from "./gamesystem/chr.js";
import { seraphimScnFormat } from "./seraphim/scnpac.js";
import { seraphimScn95Format } from "./seraphim/scnpac.js";
import { gsPackFormat } from "./gs-pack/archive.js";
import { gsDataFormat } from "./gs-pack/archive.js";
import { parsleyYanepackFormat } from "./parsley/cg.js";
import { parsleyCgV1Format } from "./parsley/cg.js";
import { paletteChrFormat } from "./palette/chr.js";
import { mngFormat } from "./mng/mng.js";
import { tanukiTacFormat } from "./tanuki/tac.js";
import { kidLnkFormat } from "./kid/lnk.js";
import { leafKcapFormat } from "./leaf/kcap.js";
import { zyxBdfFormat } from "./zyx/bdf.js";
import { kaasPdFormat } from "./kaas/pd.js";
import { gamesystemPuremailFormat } from "./gamesystem/puremail.js";
import { ritsSafFormat } from "./rits/saf.js";
import { supernekoxGpc7Format } from "./supernekox/gpc.js";
import { gssLsdFormat } from "./gss/lsd.js";
import { strikesPckFormat } from "./strikes/pck.js";
import { lucifenLpkFormat } from "./lucifen/lpk.js";
import { ellefinEpkFormat } from "./ellefin/epk.js";
import { g2PakFormat } from "./g2/pak.js";
import { willArc2Format } from "./will/arc2.js";
import { pinkyA5rFormat } from "./pinky/a5r.js";
import { piasDatFormat } from "./pias/dat.js";
import { kogadoArcFormat } from "./kogado/arc.js";
import { willArcFormat } from "./will/arc.js";
import { realliveKoeFormat } from "./reallive/koe.js";
import { xuseWagFormat } from "./xuse/wag.js";
import { minaBmpPakFormat } from "./mina/pak.js";
import { minaWavPakFormat } from "./mina/pak.js";
import { minaScriptPakFormat } from "./mina/pak.js";
import { emonEmeFormat } from "./emon/eme.js";
import { livemakerVfFormat } from "./livemaker/vf.js";
import { circusVcPacFormat } from "./circus/vc.js";
import { caramelBoxArc3Format } from "./caramel-box/arc3.js";
import { caramelBoxArc4Format } from "./caramel-box/arc4.js";
import { lunePackFormat } from "./lune/pack.js";
import { nitroplusNpaSteinsGateFormat } from "./nitroplus/npa-sg.js";
import { discoveryDatFormat } from "./discovery/dat.js";
import { entisEriFormat } from "./entis/eri.js";
import { piasEncryptedFormat } from "./pias/encrypted-graph.js";
import { alicesoftAfaFormat } from "./alicesoft/afa.js";
import { abmFormat } from "./lilim/abm.js";
import { flyingShinePd3Format } from "./flying-shine/pd.js";
import { flyingShinePdFormat } from "./flying-shine/pd-legacy.js";
import { flyingShinePd2Format } from "./flying-shine/pd2.js";
import { vafsFormat } from "./softpal/vafs.js";
import { originHedDatFormat } from "./origin/dat-hed.js";
import { mmaFormat } from "./mnp/mma.js";
import { mrgFormat } from "./fc01/mrg.js";
import { mrg2Format } from "./fc01/mrg2.js";
import { valkyriaOdnFormat } from "./valkyria/odn.js";
import { kurumiMpkFormat } from "./kurumi/mpk.js";
import { eushullyAogAudioFormat } from "./eushully/aog-audio.js";
import { leafP16AudioFormat } from "./leaf/p16-audio.js";
import { ikmAudioFormat } from "./microvision/ikm-audio.js";
import { keyOggpakAudioFormat } from "./key/oggpak-audio.js";
import { vmdAudioFormat } from "./c4/vmd-audio.js";
import { voiAudioFormat } from "./slg/voi-audio.js";
import { eogAudioFormat } from "./crowd/eog-audio.js";
import { kogAudioFormat } from "./sviu/kog-audio.js";
import { aoiAogAudioFormat } from "./aoi/aog-audio.js";
import { softpalBgmAudioFormat } from "./softpal/bgm-audio.js";
import { realliveOwpAudioFormat } from "./reallive/owp-audio.js";
import { nsOpenerFormat } from "./nscripter/script.js";
import { esdAudioFormat } from "./tamasoft/esd-audio.js";
import { wstrAudioFormat } from "./ume-soft/str-audio.js";
import { brownieWavAudioFormat } from "./brownie/wav-audio.js";
import { bgiAudioFormat } from "./ethornell/bw-audio.js";
import { edimAudioFormat } from "./macromedia/edim-audio.js";
import { ogvAudioFormat } from "./shiina-rio/ogv-audio.js";
import { agsAudioFormat } from "./ags32i/wav-audio.js";
import { kwfAudioFormat } from "./dice/kwf-audio.js";
import { gssImageFormat } from "./ags32i/gss-image.js";
import { cgdImageFormat } from "./carriere/cgd-image.js";
import { tblImageFormat } from "./pan/tbl-image.js";
import { bpdImageFormat } from "./pinesoft/bpd-image.js";
import { psmImageFormat } from "./psm/image.js";
import { cp3ImageFormat } from "./seraphim/cp3-image.js";
import { mdImageFormat } from "./mina/md-image.js";
import { wmkImageFormat } from "./fc01/wmk-image.js";
import { p4agImageFormat } from "./xuse/p4ag-image.js";
import { redImageFormat } from "./ocarina/red-image.js";
import { pnxImageFormat } from "./zenos/pnx-image.js";
import { grdImageFormat } from "./silky/grd-image.js";
import { sedAudioFormat } from "./myharvest/sed-audio.js";
import { mskImageFormat } from "./cmvs/msk-image.js";
import { cwvAudioFormat } from "./uncanny/cwv-audio.js";
import { whcAudioFormat } from "./basil/whc-audio.js";
import { tmrHiroAudioFormat } from "./tmr-hiro/wav-audio.js";
import { pnxEncryptedImageFormat } from "./misc/pnx-image.js";
import { pcgImageFormat } from "./parsley/pcg-image.js";
import { gefImageFormat } from "./yellowcap/gef-image.js";
import { csfImageFormat } from "./eye/csf-image.js";
import { msfAudioFormat } from "./unknown/msf-audio.js";
import { cmbAudioFormat } from "./pinesoft/cmb-audio.js";
import { ggfImageFormat } from "./yellowcap/ggf-image.js";
import { befAlpImageFormat } from "./bef/alp-image.js";
import { gamesystemAlpImageFormat } from "./gamesystem/alp-image.js";
import { masysAlpImageFormat } from "./masys/alp-image.js";
import { ardImageFormat } from "./acme/ard-image.js";
import { mbImageFormat } from "./mb/image.js";
import { ngwImageFormat } from "./brownie/ngw-image.js";
import { gdfImageFormat } from "./mink/gdf-image.js";
import { isdScriptFormat } from "./ice/isd-script.js";
import { wazAudioFormat } from "./anotherroom/waz-audio.js";
import { harvestBgmAudioFormat } from "./myharvest/bgm-audio.js";
import { hiddenJpegImageFormat } from "./gaia/jpeg-image.js";
import { frmImageFormat } from "./logg/frm-image.js";
import { mbpImageFormat } from "./hmp/mbp-image.js";
import { muwAudioFormat } from "./artel/muw-audio.js";
import { um3AudioFormat } from "./bruns/um3-audio.js";
import { dwvAudioFormat } from "./sysd/dwv-audio.js";
import { qdoScriptFormat } from "./redzone/qdo-script.js";
import { nsfAudioFormat } from "./pan/nsf-audio.js";
import { htfImageFormat } from "./jam-creation/htf-image.js";
import { advgImageFormat } from "./advgsys/bmp-image.js";
import { mwpImageFormat } from "./emic/mwp-image.js";
import { leafWAudioFormat } from "./leaf/w-audio.js";
import { texbImageFormat } from "./gamesystem/texb-image.js";
import { wrgAudioFormat } from "./regrips/wrg-audio.js";
import { regripsMrgAudioFormat } from "./regrips/mrg-audio.js";
import { ankhMskImageFormat } from "./ankh/msk-image.js";
import { kurumiGraImageFormat } from "./kurumi/gra-image.js";
import { gr1ImageFormat } from "./anotherroom/gr1-image.js";
import { bgraImageFormat } from "./g2/bgra-image.js";
import { cbfImageFormat } from "./hmp/cbf-image.js";
import { system98GImageFormat } from "./system98/g-image.js";
import { desImageFormat } from "./desire/des-image.js";
import { dpcImageFormat } from "./desire/dpc-image.js";
import { tiareGraImageFormat } from "./tiare/gra-image.js";
import { ugImageFormat } from "./ucom/ug-image.js";
import { hillFieldImgImageFormat } from "./hillfield/img-image.js";
import { pbmImageFormat } from "./nekopunch/pbm-image.js";
import { kslImageFormat } from "./kscript/ksl-image.js";
import { pmpImageFormat } from "./sceneplayer/pmp-image.js";
import { vzyAudioFormat } from "./bef/vzy-audio.js";
import { nbmpImageFormat } from "./westgate/nbmp-image.js";
import { pmwAudioFormat } from "./sceneplayer/pmw-audio.js";
import { ezsAudioFormat } from "./broom/ezs-audio.js";
import { bmzImageFormat } from "./black-rainbow/bmz-image.js";
import { aloImageFormat } from "./bef/alo-image.js";
import { ankhGpdImageFormat } from "./ankh/gpd-image.js";
import { kgrImageFormat } from "./project-myu/kgr-image.js";
import { lzBmpImageFormat } from "./misc/lz-bmp-image.js";
import { bbmImageFormat } from "./blue-gale/bbm-image.js";
import { wpnAudioFormat } from "./wildbug/wpn-audio.js";
import { wbmImageFormat } from "./hypatia/wbm-image.js";
import { surImageFormat } from "./tamasoft/sur-image.js";
import { btnImageFormat } from "./tamasoft/btn-image.js";
import { plantechPacImageFormat } from "./plantech/pac-image.js";
import { mgfImageFormat } from "./malie/mgf-image.js";
import { hotImageFormat } from "./hdl/hot-image.js";
import { pgaImageFormat } from "./palette/pga-image.js";
import { bpicImageFormat } from "./softpal/bpic-image.js";
import { rmtImageFormat } from "./elf/rmt-image.js";
import { picImageFormat } from "./misc/pic-image.js";
import { lgfImageFormat } from "./leaf/lgf-image.js";
import { wm2ImageFormat } from "./fc01/wm2-image.js";
import { malImageFormat } from "./valkyria/mal-image.js";
import { texImageFormat } from "./system21/tex-image.js";
import { ggaImageFormat } from "./ikura/gga-image.js";
import { thpImageFormat } from "./primesoft/thp-image.js";
import { ikeAudioFormat } from "./ume-soft/ike-audio.js";
import { iceAudioFormat } from "./ankh/ice-audio.js";
import { ikeImageFormat } from "./ume-soft/ike-image.js";
import { opfImageFormat } from "./hcsystem/opf-image.js";

export * from "./advsys/index.js";
export * from "./active-soft/index.js";
export * from "./ail/index.js";
export * from "./amaterasu/index.js";
export * from "./artemis/index.js";
export * from "./basil/index.js";
export * from "./bishop/index.js";
export * from "./banana/index.js";
export * from "./black-rainbow/index.js";
export * from "./clio/index.js";
export * from "./circus/index.js";
export * from "./cat-system/index.js";
export * from "./cri/index.js";
export * from "./abel/index.js";
export * from "./antique/index.js";
export * from "./dall/index.js";
export * from "./ethornell/index.js";
export * from "./escude/index.js";
export * from "./favorite/index.js";
export * from "./fc01/index.js";
export * from "./gsx/index.js";
export * from "./gpk2/index.js";
export * from "./interheart/index.js";
export * from "./irrlicht/index.js";
export * from "./hypatia/index.js";
export * from "./kaas/index.js";
export * from "./kscript/index.js";
export * from "./kiss/index.js";
export * from "./ikura/index.js";
export * from "./ivory/index.js";
export * from "./liddell/index.js";
export * from "./leaf/index.js";
export * from "./muse/index.js";
export * from "./myharvest/index.js";
export * from "./mutation/index.js";
export * from "./majiro/index.js";
export * from "./mg/index.js";
export * from "./microvision/index.js";
export * from "./nekopack/index.js";
export * from "./nexton/index.js";
export * from "./oneup/index.js";
export * from "./nitroplus/index.js";
export * from "./plantech/index.js";
export * from "./pinesoft/index.js";
export * from "./parsley/index.js";
export * from "./seraphim/index.js";
export * from "./succubus/index.js";
export * from "./selene/index.js";
export * from "./silky/index.js";
export * from "./sysd/index.js";
export * from "./redzone/index.js";
export * from "./uran/index.js";
export * from "./triangle/index.js";
export * from "./tail/index.js";
export * from "./tanaka/index.js";
export * from "./system-epsilon/index.js";
export * from "./tinkerbell/index.js";
export * from "./ucom/index.js";
export * from "./winters/index.js";
export * from "./valkyria/index.js";
export * from "./zone/index.js";
export * from "./xp3/index.js";
export * from "./alicesoft/index.js";
export * from "./cdpa/index.js";
export * from "./hyperworks/index.js";
export * from "./brownie/index.js";
export * from "./aquarium/index.js";
export * from "./sceplay/index.js";
export * from "./tigerman/index.js";
export * from "./iris/index.js";
export * from "./herb/index.js";
export * from "./applepie/index.js";
export * from "./artel/index.js";
export * from "./rsystem/index.js";
export * from "./unknown/index.js";
export * from "./weapon/index.js";
export * from "./palette/index.js";
export * from "./mina/index.js";
export * from "./witch/index.js";
export * from "./ipac/index.js";
export * from "./bellda/index.js";
export * from "./nekotaro/index.js";
export * from "./taskforce/index.js";
export * from "./alpha-system/index.js";
export * from "./slg/index.js";
export * from "./cherry/index.js";
export * from "./arcx/index.js";
export * from "./mmfass/index.js";
export * from "./marble/index.js";
export * from "./pan/index.js";
export * from "./desire/index.js";
export * from "./cadath/index.js";
export * from "./asura/index.js";
export * from "./blue-gale/index.js";
export * from "./black-cyc/index.js";
export * from "./tetratech/index.js";
export * from "./aos/index.js";
export * from "./keroq/index.js";
export * from "./ransel/index.js";
export * from "./pkware/index.js";
export * from "./aims/index.js";
export * from "./pearl/index.js";
export * from "./akatombo/index.js";
export * from "./rhss/index.js";
export * from "./lambda/index.js";
export * from "./ffa/index.js";
export * from "./ads/index.js";
export * from "./aaru/index.js";
export * from "./gscripter/index.js";
export * from "./types/index.js";
export * from "./xuse/index.js";
export * from "./eternity/index.js";
export * from "./uma/index.js";
export * from "./westgate/index.js";
export * from "./liar/index.js";
export * from "./force/index.js";
export * from "./rpm/index.js";
export * from "./entexec/index.js";
export * from "./advdx/index.js";
export * from "./dmotion/index.js";
export * from "./reallive/index.js";
export * from "./propeller/index.js";
export * from "./topcat/index.js";
export * from "./hexenhaus/index.js";
export * from "./nags/index.js";
export * from "./kirikiri/index.js";
export * from "./xiks/index.js";
export * from "./frontwing/index.js";
export * from "./yatagarasu/index.js";
export * from "./mixwill/index.js";
export * from "./mink/index.js";
export * from "./yane-sdk/index.js";
export * from "./shiina-rio/index.js";
export * from "./patisserie/index.js";
export * from "./hdl/index.js";
export * from "./neon/index.js";
export * from "./kasane/index.js";
export * from "./mno-violet/index.js";
export * from "./umut/index.js";
export * from "./airyu/index.js";
export * from "./pochette/index.js";
export * from "./kapp/index.js";
export * from "./elf/index.js";
export * from "./masys/index.js";
export * from "./nejii/index.js";
export * from "./yaneurao/index.js";
export * from "./pajamas/index.js";
export * from "./sceneplayer/index.js";
export * from "./umesoft/index.js";
export * from "./electriciteit/index.js";
export * from "./abogado/index.js";
export * from "./paprika/index.js";
export * from "./squadrad/index.js";
export * from "./marron/index.js";
export * from "./tsd/index.js";
export * from "./noesis/index.js";
export * from "./djsystem/index.js";
export * from "./cmvs/index.js";
export * from "./csware/index.js";
export * from "./tactics/index.js";
export * from "./astronauts/index.js";
export * from "./foster/index.js";
export * from "./jupiter/index.js";
export * from "./rune/index.js";
export * from "./musica/index.js";
export * from "./tako/index.js";
export * from "./broom/index.js";
export * from "./adobe/index.js";
export * from "./origin/index.js";
export * from "./emic/index.js";
export * from "./techno-brain/index.js";
export * from "./techgian/index.js";
export * from "./speed/index.js";
export * from "./luna-soft/index.js";
export * from "./lilim/index.js";
export * from "./nekopunch/index.js";
export * from "./mugi/index.js";
export * from "./crowd/index.js";
export * from "./aypio/index.js";
export * from "./melonpan/index.js";
export * from "./scoop/index.js";
export * from "./rain/index.js";
export * from "./spack/index.js";
export * from "./jam-creation/index.js";
export * from "./omi/index.js";
export * from "./system21/index.js";
export * from "./ism/index.js";
export * from "./ume-soft/index.js";
export * from "./softpal/index.js";
export * from "./scrplayer/index.js";
export * from "./mai/index.js";
export * from "./palm-tree/index.js";
export * from "./wild-bug/index.js";
export * from "./kaguya/index.js";
export * from "./nscripter/index.js";
export * from "./key/index.js";
export * from "./studio-ego/index.js";
export * from "./shsystem/index.js";
export * from "./dd-system/index.js";
export * from "./eushully/index.js";
export * from "./aoi/index.js";
export * from "./manga-gamer/index.js";
export * from "./ex-hibit/index.js";
export * from "./q-lie/index.js";
export * from "./nyoken/index.js";
export * from "./libido/index.js";
export * from "./otemoto/index.js";
export * from "./digital-monkey/index.js";
export * from "./morning/index.js";
export * from "./studio-sakura/index.js";
export * from "./nug/index.js";
export * from "./riddle/index.js";
export * from "./myadv/index.js";
export * from "./maika/index.js";
export * from "./pinpai/index.js";
export * from "./giga/index.js";
export * from "./sogna/index.js";
export * from "./dice/index.js";
export * from "./yox/index.js";
export * from "./entis/index.js";
export * from "./digital-works/index.js";
export * from "./psp/index.js";
export * from "./nekosdk/index.js";
export * from "./will/index.js";
export * from "./gamesystem/index.js";
export * from "./hcsystem/index.js";
export * from "./vnsystem/index.js";
export * from "./cromwell/index.js";
export * from "./sohfu/index.js";
export * from "./ebg-system/index.js";
export * from "./alterna/index.js";
export * from "./ebisu/index.js";
export * from "./penguin/index.js";
export * from "./clickteam/index.js";
export * from "./misc/index.js";
export * from "./ponytail/index.js";
export * from "./ankh/index.js";
export * from "./shapeshifter/index.js";
export * from "./malie/index.js";
export * from "./dogenzaka/index.js";
export * from "./sophia/index.js";
export * from "./unison/index.js";
export * from "./factor/index.js";
export * from "./logg/index.js";
export * from "./glib/index.js";
export * from "./black-butterfly/index.js";
export * from "./debonosu/index.js";
export * from "./vn-engine/index.js";
export * from "./anime-game-system/index.js";
export * from "./ast/index.js";
export * from "./carriere/index.js";
export * from "./system98/index.js";
export * from "./densdk/index.js";
export * from "./tmr-hiro/index.js";
export * from "./tamasoft/index.js";
export * from "./youkai/index.js";
export * from "./advscripter/index.js";
export * from "./apricot/index.js";
export * from "./cyberworks/index.js";
export * from "./pandora/index.js";
export * from "./nonono/index.js";
export * from "./system-aqua/index.js";
export * from "./yuka/index.js";
export * from "./moko-pro/index.js";
export * from "./eve/index.js";
export * from "./nexas/index.js";
export * from "./hsp/index.js";
export * from "./ugos/index.js";
export * from "./dai-system/index.js";
export * from "./n-system/index.js";
export * from "./inspire/index.js";
export * from "./groover/index.js";
export * from "./splush-wave/index.js";
export * from "./lazycrew/index.js";
export * from "./rare/index.js";
export * from "./gs-pack/index.js";
export * from "./mng/index.js";
export * from "./tanuki/index.js";
export * from "./kid/index.js";
export * from "./zyx/index.js";
export * from "./rits/index.js";
export * from "./supernekox/index.js";
export * from "./gss/index.js";
export * from "./strikes/index.js";
export * from "./lucifen/index.js";
export * from "./ellefin/index.js";
export * from "./g2/index.js";
export * from "./pinky/index.js";
export * from "./pias/index.js";
export * from "./kogado/index.js";
export * from "./emon/index.js";
export * from "./livemaker/index.js";
export * from "./caramel-box/index.js";
export * from "./lune/index.js";
export * from "./discovery/index.js";
export * from "./flying-shine/index.js";
export * from "./mnp/index.js";
export * from "./kurumi/index.js";
export * from "./c4/index.js";
export * from "./sviu/index.js";
export * from "./macromedia/index.js";
export * from "./ags32i/index.js";
export * from "./psm/index.js";
export * from "./ocarina/index.js";
export * from "./zenos/index.js";
export * from "./uncanny/index.js";
export * from "./yellowcap/index.js";
export * from "./eye/index.js";
export * from "./bef/index.js";
export * from "./acme/index.js";
export * from "./mb/index.js";
export * from "./ice/index.js";
export * from "./anotherroom/index.js";
export * from "./gaia/index.js";
export * from "./hmp/index.js";
export * from "./bruns/index.js";
export * from "./advgsys/index.js";
export * from "./regrips/index.js";
export * from "./tiare/index.js";
export * from "./hillfield/index.js";
export * from "./project-myu/index.js";
export * from "./wildbug/index.js";
export * from "./primesoft/index.js";

export function createDefaultRegistry(): FormatRegistry {
	return new FormatRegistry([
		new Xp3Format(),
		new Adpack32Format(),
		bananaPkFormat,
		spcFormat,
		ailDatFormat,
		advSysFpkFormat,
		bishopBscFormat,
		ccfFormat,
		circusPckFormat,
		flkFormat,
		fpk2Format,
		irrlichtPackFormat,
		kissArcFormat,
		pinesoftVoiceFormat,
		sudFormat,
		lnk2Format,
		nppFormat,
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
		new PackDatFormat(),
		new KcapFormat(),
		new HyPackFormat(),
		new LstFormat(),
		new MajiroArcFormat(),
		new NekoPack3Format(),
		new NekoPack2Format(),
		new NekoPack1Format(),
		new AcpxFormat(),
		new FavoriteBinFormat(),
		abelBinFormat,
		antiqueDatFormat,
		gpk2Format,
		kaasPbFormat,
		kpcFormat,
		leafPxFormat,
		leafTexFormat,
		oneUpArcFormat,
		seraphimMcFormat,
		succubusArcFormat,
		tailPkgFormat,
		tanakaArc0Format,
		tanakaWvxFormat,
		mrg0Format,
		clioPacFormat,
		dallPelFormat,
		dpfFormat,
		ifxFormat,
		unaDatFormat,
		museDatFormat,
		parsleyScnFormat,
		plantechPacFormat,
		phsFormat,
		redzonePakFormat,
		k5Format,
		pkdFormat,
		dpkFormat,
		gsdFormat,
		mjaFormat,
		mifFormat,
		bishopPkFormat,
		ivorySgFormat,
		ivoryPxFormat,
		vsdFormat,
		silkyArcFormat,
		silkyMfgFormat,
		ukFormat,
		shaFormat,
		mpkFormat,
		parsleyPacFormat,
		valkyriaDatFormat,
		valkyriaAm2Format,
		p8Format,
		alkFormat,
		cdpaPackFormat,
		hyperworksPakFormat,
		nafFormat,
		cpaFormat,
		sceplayPakFormat,
		tigermanPacFormat,
		irisFpackFormat,
		herbPakFormat,
		applePieArcFormat,
		pfdFormat,
		radFormat,
		k3Format,
		aqaFormat,
		weaponVoiceFormat,
		palettePakFormat,
		ml2Format,
		vbdFormat,
		pcdImageFormat,
		lpkFormat,
		ipacFormat,
		bldFormat,
		nscFormat,
		taskforceDatFormat,
		alphaSystemPakFormat,
		szsFormat,
		capybaraDatFormat,
		mykFormat,
		arcxFormat,
		sdaFormat,
		bmxFormat,
		dnsFormat,
		panFormat,
		dsvFormat,
		karFormat,
		asuraPakFormat,
		pak2Format,
		snnFormat,
		vpkFormat,
		bndFormat,
		aosDatFormat,
		keroqDatFormat,
		bcdFormat,
		zipFormat,
		aimsPackFormat,
		cfpFormat,
		aryFormat,
		akatomboXFormat,
		crgFormat,
		abelFpkFormat,
		clsFormat,
		ffaFormat,
		pogFormat,
		irrlichtArkFormat,
		fl2Format,
		fl3Format,
		gscripterDataFormat,
		chrFormat,
		witchArcFormat,
		typesArcFormat,
		gdFormat,
		aapFormat,
		mirisDatFormat,
		cdtFormat,
		usfFormat,
		iafFormat,
		lwgFormat,
		paqFormat,
		triangleDatFormat,
		rpmArcFormat,
		rpmZenosFormat,
		cabFormat,
		glnkFormat,
		advdxPkdFormat,
		dmotionPackFormat,
		ovkFormat,
		propellerMpkFormat,
		tcd1Format,
		odioFormat,
		nfsFormat,
		xpkFormat,
		xuseBinFormat,
		mbfFormat,
		blackRainbowDatFormat,
		iksFormat,
		fgFormat,
		cp3Format,
		crmFormat,
		pkgFormat,
		gpkFormat,
		arc0Format,
		minkGrpFormat,
		yaneDatFormat,
		s25Format,
		hg2Format,
		hg3Format,
		patisserieRawFormat,
		tanakaVpkFormat,
		ifpFormat,
		xarcFormat,
		dafFormat,
		hotFormat,
		advSys3Format,
		neonAr2Format,
		kasaneAr2Format,
		witchDatFormat,
		mnvFormat,
		umpkFormat,
		airyuChrFormat,
		animFormat,
		pochettePacFormat,
		cgdFormat,
		ucomDataFormat,
		ai5DatFormat,
		awfFormat,
		mgdFormat,
		wvbFormat,
		pcdFormat,
		aldFormat,
		yaneSdaFormat,
		gameDatFormat,
		pmxFormat,
		pmaFormat,
		gr2Format,
		spdFormat,
		electriciteitDatFormat,
		dskFormat,
		pkDatFormat,
		plaFormat,
		cpnFormat,
		mcdFormat,
		igaFormat,
		djDatFormat,
		cpz1Format,
		arc2Format,
		yuFormat,
		gxpFormat,
		c24Format,
		c25Format,
		lb5Format,
		cgV2Format,
		ykFormat,
		ucgFormat,
		voiceFormat,
		arccFormat,
		sdaSdFormat,
		sqzFormat,
		mpkHgFormat,
		tanFormat,
		csPackFormat,
		cpcFormat,
		airFormat,
		gafFormat,
		emicFormat,
		ipqFormat,
		aniFormat,
		microVisionArcFormat,
		dxFormat,
		smvFormat,
		cgfFormat,
		techgianBinFormat,
		speedArcFormat,
		hzcMultiFormat,
		lunaPacFormat,
		fgaFormat,
		aos2Format,
		aosFormat,
		azuriteFormat,
		ai6WinFormat,
		nekopunchPakFormat,
		mugiBinFormat,
		crowdPckFormat,
		dlbFormat,
		dlbV0Format,
		morningTtdFormat,
		studioSakuraDatFormat,
		fwaFormat,
		riddlePacFormat,
		myAdvPacFormat,
		maikaMik01Format,
		gxFormat,
		dl1Format,
		nejiiCdtFormat,
		rainBinFormat,
		aarFormat,
		ucaFormat,
		uwfFormat,
		spackFormat,
		pkkFormat,
		jamDatFormat,
		adsPacFormat,
		bsaFormat,
		ivoryPkFormat,
		omiDatFormat,
		system21PakFormat,
		isaFormat,
		circusDatFormat,
		mgxFormat,
		broomPkFormat,
		broomEncryptedPkFormat,
		softpalPacFormat,
		amusePacFormat,
		scrPlayerPakFormat,
		maiFormat,
		arFormat,
		a98Format,
		wbpFormat,
		kaguyaPltFormat,
		kaguyaPl10Format,
		kaguyaAn21Format,
		nscripterSarFormat,
		keyPakFormat,
		egoDatFormat,
		egoOldDatFormat,
		him4Format,
		him5Format,
		ddp2Format,
		ddp3Format,
		gpcFormat,
		sndFormat,
		snrFormat,
		anmFormat,
		an10Format,
		an20Format,
		volFormat,
		vfsFormat,
		boxFormat,
		aoimyFormat,
		aoimyUnicodeFormat,
		mgpk0Format,
		hedFormat,
		wsm0Format,
		wsm1Format,
		wsm2Format,
		wsm4Format,
		arcgFormat,
		vcPakFormat,
		xflFormat,
		exhGRPFormat,
		abmpFormat,
		abmp7Format,
		spPakFormat,
		meltyPakFormat,
		zlkFormat,
		iflFormat,
		libidoArcFormat,
		tlzFormat,
		dmFormat,
		ttdFormat,
		pinpaiArcxFormat,
		gigaTpfFormat,
		sognaDatFormat,
		diceRlzFormat,
		sdtFormat,
		unknownDatFormat,
		yoxDatFormat,
		entisPacFormat,
		triangleBmxFormat,
		digitalWorksPacFormat,
		pspQpkFormat,
		nitroplusPakFormat,
		nekosdkDatFormat,
		willWipFormat,
		leafAFormat,
		seenFormat,
		gamesystemDatFormat,
		abelArcFormat,
		cpz2Format,
		cswareDatFormat,
		hcsystemPakFormat,
		vnsystemVfsFormat,
		cromwellPakFormat,
		cromwellOpkFormat,
		propellerMgrFormat,
		sohfuSkaFormat,
		kaguyaUfFormat,
		umeSoftPkFormat,
		archangelDatFormat,
		ebgSystemBinFormat,
		alternaBinFormat,
		ebisuEp1Format,
		umeSoftBinFormat,
		penguinPacFormat,
		blueGaleAmvFormat,
		clickTeamMfsFormat,
		miscBinFormat,
		ponytailBndFormat,
		ankhGrpFormat,
		ankhDatFormat,
		shapeShifterBndFormat,
		ffaDatFormat,
		ffaJdatFormat,
		malieLibuFormat,
		willPnaFormat,
		yaneuraoDatDxFormat,
		yaneuraoDatExFormat,
		leafLacFormat,
		leafLacPakFormat,
		blackRainbowImpFormat,
		dogenzakaBinFormat,
		dogenzakaGameDatFormat,
		sophiaNorFormat,
		maikaBkFormat,
		unisonVctFormat,
		factorResFormat,
		nekoSdkPakFormat,
		loggArfFormat,
		glibGFormat,
		blackButterflyDatFormat,
		debonosuPakFormat,
		vnEngineAxrFormat,
		animeGameSystemAniFormat,
		animeGameSystemDatFormat,
		maikaMk2Format,
		astArcFormat,
		leafAr2Format,
		leafAmFormat,
		carriereArcFormat,
		carriereScenarioFormat,
		kaguyaLin2Format,
		system98LibFormat,
		frontWingFltFormat,
		densdkDaf1Format,
		densdkDaf2Format,
		pfsFormat,
		tmrHiroPacFormat,
		eushullyAlfFormat,
		gamesystemCmpFormat,
		tamasoftEpkFormat,
		youkaiDatGrpFormat,
		youkaiDatSoundFormat,
		youkaiDatVoiceFormat,
		crowdPkwvFormat,
		advscripterPakFormat,
		uranNclFormat,
		apricotDatFormat,
		cyberworksAppendixFormat,
		cyberworksDatFormat,
		cyberworksCsystemDatFormat,
		cyberworksCsystemDat2Format,
		pandoraPbxFormat,
		nononoNpfFormat,
		shiinaRioWarcFormat,
		realliveG00Format,
		nitroplusNitroPakFormat,
		systemAquaCatfFormat,
		yukaYkcFormat,
		mokoProNnnnFormat,
		eveGmFormat,
		studioEgoPak0Format,
		nexasPacFormat,
		aaruFl4Format,
		wagFormat,
		mcaFormat,
		dpmFormat,
		detFormat,
		daiPacFormat,
		ganFormat,
		laxFormat,
		fjsysFormat,
		idaFormat,
		ozFormat,
		fpkFormat,
		pcsFormat,
		vavFormat,
		fa2Format,
		cherryPakFormat,
		cherryPak2Format,
		grooverPcgFormat,
		flkDatFormat,
		asdKToolFormat,
		asdSpielFormat,
		kaguyaAriFormat,
		xuseBgFormat,
		xuseHFormat,
		xuseArcFormat,
		xuseKotoriFormat,
		lazycrewDatFormat,
		parsleyDesertCgFormat,
		rareXFormat,
		tailCafFormat,
		gameSystemChrFormat,
		seraphimScnFormat,
		seraphimScn95Format,
		gsPackFormat,
		gsDataFormat,
		parsleyYanepackFormat,
		parsleyCgV1Format,
		paletteChrFormat,
		mngFormat,
		tanukiTacFormat,
		kidLnkFormat,
		leafKcapFormat,
		zyxBdfFormat,
		kaasPdFormat,
		gamesystemPuremailFormat,
		ritsSafFormat,
		supernekoxGpc7Format,
		gssLsdFormat,
		strikesPckFormat,
		lucifenLpkFormat,
		ellefinEpkFormat,
		g2PakFormat,
		willArc2Format,
		pinkyA5rFormat,
		piasDatFormat,
		kogadoArcFormat,
		willArcFormat,
		realliveKoeFormat,
		xuseWagFormat,
		minaBmpPakFormat,
		minaWavPakFormat,
		minaScriptPakFormat,
		emonEmeFormat,
		livemakerVfFormat,
		circusVcPacFormat,
		caramelBoxArc3Format,
		caramelBoxArc4Format,
		lunePackFormat,
		nitroplusNpaSteinsGateFormat,
		discoveryDatFormat,
		entisEriFormat,
		piasEncryptedFormat,
		alicesoftAfaFormat,
		abmFormat,
		flyingShinePd3Format,
		flyingShinePdFormat,
		flyingShinePd2Format,
		vafsFormat,
		originHedDatFormat,
		mmaFormat,
		mrgFormat,
		mrg2Format,
		valkyriaOdnFormat,
		kurumiMpkFormat,
		eushullyAogAudioFormat,
		leafP16AudioFormat,
		ikmAudioFormat,
		keyOggpakAudioFormat,
		vmdAudioFormat,
		voiAudioFormat,
		eogAudioFormat,
		kogAudioFormat,
		aoiAogAudioFormat,
		softpalBgmAudioFormat,
		realliveOwpAudioFormat,
		nsOpenerFormat,
		esdAudioFormat,
		wstrAudioFormat,
		brownieWavAudioFormat,
		bgiAudioFormat,
		edimAudioFormat,
		ogvAudioFormat,
		agsAudioFormat,
		kwfAudioFormat,
		gssImageFormat,
		cgdImageFormat,
		tblImageFormat,
		bpdImageFormat,
		psmImageFormat,
		cp3ImageFormat,
		mdImageFormat,
		wmkImageFormat,
		p4agImageFormat,
		redImageFormat,
		pnxImageFormat,
		grdImageFormat,
		sedAudioFormat,
		mskImageFormat,
		cwvAudioFormat,
		whcAudioFormat,
		tmrHiroAudioFormat,
		pnxEncryptedImageFormat,
		pcgImageFormat,
		gefImageFormat,
		csfImageFormat,
		msfAudioFormat,
		cmbAudioFormat,
		ggfImageFormat,
		befAlpImageFormat,
		gamesystemAlpImageFormat,
		masysAlpImageFormat,
		ardImageFormat,
		mbImageFormat,
		ngwImageFormat,
		gdfImageFormat,
		isdScriptFormat,
		wazAudioFormat,
		harvestBgmAudioFormat,
		hiddenJpegImageFormat,
		frmImageFormat,
		mbpImageFormat,
		muwAudioFormat,
		um3AudioFormat,
		dwvAudioFormat,
		qdoScriptFormat,
		nsfAudioFormat,
		htfImageFormat,
		advgImageFormat,
		mwpImageFormat,
		leafWAudioFormat,
		texbImageFormat,
		wrgAudioFormat,
		regripsMrgAudioFormat,
		ankhMskImageFormat,
		kurumiGraImageFormat,
		gr1ImageFormat,
		bgraImageFormat,
		cbfImageFormat,
		system98GImageFormat,
		desImageFormat,
		dpcImageFormat,
		tiareGraImageFormat,
		ugImageFormat,
		hillFieldImgImageFormat,
		pbmImageFormat,
		kslImageFormat,
		pmpImageFormat,
		vzyAudioFormat,
		nbmpImageFormat,
		pmwAudioFormat,
		ezsAudioFormat,
		bmzImageFormat,
		aloImageFormat,
		ankhGpdImageFormat,
		kgrImageFormat,
		lzBmpImageFormat,
		bbmImageFormat,
		wpnAudioFormat,
		wbmImageFormat,
		surImageFormat,
		btnImageFormat,
		plantechPacImageFormat,
		mgfImageFormat,
		hotImageFormat,
		pgaImageFormat,
		bpicImageFormat,
		rmtImageFormat,
		picImageFormat,
		lgfImageFormat,
		wm2ImageFormat,
		malImageFormat,
		texImageFormat,
		ggaImageFormat,
		thpImageFormat,
		ikeAudioFormat,
		iceAudioFormat,
		ikeImageFormat,
		opfImageFormat,
	]);
}
