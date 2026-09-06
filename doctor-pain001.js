// doctor-pain001.js: SEPA pain.001 Doctor (slovenské banky) core logic.
//
// Pure, deterministic, 100% client-side: given the text of a SEPA
// pain.001.001.03 XML batch payment file (hromadný príkaz na úhradu) and the
// target Slovak bank, parses the XML with a small dependency-free tolerant
// parser (works identically in the browser and in Node: no DOMParser, no
// npm dependency) and cross-checks it against that bank's own published
// import requirements, returning concrete problems + copy-paste fixes.
//
// Nothing in this file makes a network request. It only reads the string /
// object you pass to diagnose().
//
// Sources (fetched directly, quoted/paraphrased inline near each check):
//  - Tatra banka: "Prenosový formát pain.001.001.03 v štruktúre XML"
//      C:\Users\User\Downloads\prenosovy_formatpain001.pdf (read in full,
//      pages 1-8): GrpHdr/PmtInf field tables, "Max. 500 transakcií v
//      súbore", ReqdExctnDt "Nesmie byť spätný dátum a dopredný dátum viac
//      ako 31 dní", DbtrAgt/BIC "Musí byť iba TATRSKBX", CdtrAgt/BIC
//      derivation-from-IBAN rule, Slovak BBAN modulo-11 check on the last 10
//      digits of a Slovak creditor IBAN, "Povolená je iba jedna inštancia
//      Ustrd."
//  - VÚB, a.s.: "Popis formátu pre SEPA úhrady - SCT"
//      https://app.vub.sk/source/files/vubweb/sekundarna-navigacia/informacny-servis/sepa-aplikacie/sct_klient_f.pdf
//      (fetched directly): "VÚB akceptuje platby s požadovaným dátumom
//      zaúčtovania platby max +30 dní vopred", DbtrAgt BIC "SUBASKBX",
//      Creditor Agent BIC AT23 marked Mandatory ("M"), PmtMtd "TRF", SvcLvl
//      Cd "SEPA", ChrgBr "SLEV", InstrPrty NORM/HIGH with HIGH processed as
//      a priority/fee-bearing payment instead of standard SEPA.
//  - ČSOB: "BusinessBanking Lite a SEPA" (20.08.2015)
//      https://www.csob.sk/documents/11005/123723/BB_SEPA_01022016.pdf
//      (fetched directly): "SEPA XML s diakritikou nie je možné do
//      BusinessBanking Lite importovať", exact allowed character set
//      (a-z, A-Z, 0-9, / – ? : ( ) . , ' +), BIC banky príjemcu "od 1.2.2016
//      bude BIC nepovinný", VS/ŠS/KS convention "/VS.../SS.../KS..." in
//      that exact order with worked wrong-order examples.
//  - ISO 20022 pain.001.001.03 (base schema referenced by all of the above;
//      https://www.iso20022.org/) and the EPC SEPA Credit Transfer scheme
//      rulebook (https://www.europeanpaymentscouncil.eu/): general
//      Max35Text/Max70Text/Max140Text field-length conventions, EUR-only
//      InstdAmt, PmtMtd=TRF / ChrgBr=SLEV as scheme-level fixed values.
//  - Slovenská sporiteľňa (SLSP): no field-level pain.001 spec is published
//      the way the three above are; the one documented, checkable rule used
//      here is Business24's requirement of PmtTpInf/LclInstrm/Cd = "INST"
//      to route a payment as an instant SEPA transfer instead of a standard
//      one (SLSP's own public Business24 documentation).
//
// Works as an ES module (import { diagnose, expectedValues } from
// './doctor-pain001.js') and, when loaded with <script type="module">, also
// publishes window.SepaDoctor = { diagnose, expectedValues } for
// console/debug use.

// ───────────────────────────── small helpers ─────────────────────────────

// ───────────────────────── jazyk hlášok ─────────────────────────
// Engine bežal len po slovensky. Andrej to 6. 9. 2026 videl na nemeckej
// stránke: rozhranie po nemecky, diagnóza po slovensky. To isté platilo pre
// generátor, ktorý tento engine používa na kontrolu, a práve naň ide nemecká
// reklama.
//
// Hlášky sú tu ako funkcie, nie ako reťazce s náhradami: každý jazyk si tak
// vie poskladať vetu vo svojom slovoslede a nemusí kopírovať poradie
// argumentov zo slovenčiny. Kľúč je vždy rovnaký ako kód problému, aby sa
// dvojica dala nájsť očami.
//
// Predvolený jazyk je slovenčina. diagnose({ lang: 'de' }) prepne celý výstup
// vrátane súhrnu, kontrolného zoznamu a právnej poznámky.

const SPRAVY = {
  sk: {
    strana: { Cdtr: 'príjemcu', Dbtr: 'platiteľa', UltmtCdtr: 'konečného príjemcu', UltmtDbtr: 'konečného platiteľa', InitgPty: 'zadávateľa súboru', _: 'strany platby' },
    chybaMestoKrajina: 'mesto (TwnNm) ani kód krajiny (Ctry)',
    chybaMesto: 'mesto (TwnNm)',
    chybaKrajina: 'kód krajiny (Ctry)',
    ibanFormat: 'nesprávny formát',
    ibanDlzka: (k) => 'nesprávna dĺžka pre krajinu ' + k,
    ibanSucet: 'zlyhal kontrolný súčet MOD-97',
    prazdne: '(prázdne)',
    chybaHodnota: '(chýba)',

    adresaNestrukturovana: (strana, po) => 'Adresa ' + strana + ' je zapísaná ako voľný text v <AdrLine>. ' + (po
      ? 'Od 15. novembra 2026 banka takýto súbor odmieta: adresa musí mať aspoň mesto a kód krajiny vo vlastných poliach.'
      : 'Od 15. novembra 2026 banka takýto súbor odmietne. Adresa musí mať aspoň mesto a kód krajiny vo vlastných poliach; dovtedy prejde, potom nie.'),
    adresaBezMestaKrajiny: (strana, chyba) => 'Adresa ' + strana + ' má štruktúrované polia, ale chýba v nej ' + chyba + '. To je od 15. novembra 2026 povinné minimum pre každú adresu v SEPA platbe.',
    adresaVelaRiadkov: (n) => 'Hybridná adresa smie mať najviac dva riadky <AdrLine>, tento má ' + n + '. Ulicu a číslo presuňte do <StrtNm> a <BldgNb>.',
    adresaZlyKodKrajiny: (k) => 'Kód krajiny "' + k + '" nie je dvojpísmenový kód podľa ISO 3166-1. Banka ho odmietne.',

    xmlPrazdne: 'Nebol vložený žiadny XML obsah. Vložte celý súbor pain.001, ktorý ste exportovali z účtovného softvéru.',
    xmlZleFormovane: (prva, dalsich) => 'XML nie je správne formované (well-formed): ' + prva + (dalsich ? ' (a ' + dalsich + ' ďalších problémov so štruktúrou.)' : '') + ' Banka takýto súbor odmietne skôr, než sa dostane k obsahu platieb.',
    chybaDocument: 'Koreňový element <Document> sa v súbore nenašiel. Toto nie je platný pain.001 súbor (alebo XML je natoľko poškodené, že sa element nedá nájsť).',
    chybaXmlns: (ns) => 'Element <Document> nemá nastavený menný priestor (xmlns). Všetky štyri banky spracúvajú pain.001.001.03 s menným priestorom "' + ns + '": bez neho môže import zlyhať alebo byť interpretovaný nesprávne.',
    verzia09Skoro: 'Súbor je pain.001.001.09. Je to správna a novšia verzia, ale slovenské banky pri importe hromadného príkazu k dnešnému dňu bežne očakávajú pain.001.001.03. Ak vám import neprejde, pošlite ten istý súbor vo verzii .03; od 15. 11. 2026 to bude naopak.',
    neznamyNs: (ns, novsia) => 'Menný priestor "' + ns + '" nie je pain.001.001.03 ani .09. ' + (novsia
      ? 'Vyzerá to na inú verziu pain.001, ktorú tieto banky pri importe hromadného príkazu nepodporujú'
      : 'Tatra banka, SLSP, VÚB aj ČSOB pri importe hromadného príkazu spracúvajú pain.001.001.03, od 15. 11. 2026 postupne .09') + ': súbor s iným menným priestorom banka odmietne alebo import zlyhá bez jasnej príčiny.',
    verzia03PoTermine: 'Súbor je pain.001.001.03. Adresné pravidlá platné od 15. 11. 2026 v nej splniť viete, ale časť bánk k tomuto termínu prechádza na pain.001.001.09 a staršiu verziu prestáva prijímať. Overte si v internetbankingu, ktorú verziu vaša banka ešte berie.',
    chybaCstmr: '<Document> neobsahuje <CstmrCdtTrfInitn>. Bez tohto elementu súbor nemá žiadnu platbu na spracovanie.',
    chybaPmtInf: 'Súbor neobsahuje žiadny blok <PmtInf>. Bez neho nie je čo spracovať.',
    chybaTx: 'Ani jeden blok <PmtInf> neobsahuje transakciu <CdtTrfTxInf>. Súbor neprenáša žiadnu platbu.',
    msgIdDlhy: (n) => 'GrpHdr/MsgId má ' + n + ' znakov, maximum je 35 (Max35Text). Banka môže hodnotu skrátiť alebo súbor odmietnuť.',
    msgIdZnaky: 'GrpHdr/MsgId obsahuje znaky mimo bežnej SEPA znakovej sady (a-z A-Z 0-9 / - ? : ( ) . , \' + medzera). Odporúčame používať len tieto znaky pre istotu naprieč bankami.',
    creDtTmZly: (v) => 'GrpHdr/CreDtTm "' + v + '" nie je platný ISO dátum/čas (napr. 2026-09-04T09:00:00).',
    nbOfTxsNesedi: (uv, sk) => 'GrpHdr/NbOfTxs uvádza ' + uv + ', ale súbor obsahuje ' + sk + ' transakcií <CdtTrfTxInf>. Nezhoda počtu transakcií je jeden z najčastejších dôvodov zamietnutia importu.',
    ctrlSumNesedi: (uv, sk) => 'GrpHdr/CtrlSum uvádza ' + uv + ', súčet InstdAmt všetkých transakcií je však ' + sk + '.',
    initgPtyVzor: (nm) => 'Tatra banka očakáva GrpHdr/InitgPty/Nm vo formáte [A-Za-z0-9]{1,10}/[A-Z]{2} (napr. "ABC1234567/SK"), ak je toto pole vyplnené. Hodnota "' + nm + '" tomuto vzoru nezodpovedá: pole je však celkovo nepovinné, takže ho pokojne aj úplne vynechajte.',
    diakritikaCsob: (v) => '"' + v + '" obsahuje diakritiku. ČSOB výslovne uvádza, že SEPA XML súbor s diakritikou sa do BusinessBanking Lite nedá importovať vôbec.',
    diakritikaVseobecne: (v) => '"' + v + '" obsahuje diakritiku. SEPA XML znaková sada (podľa dokumentácie ČSOB, platí všeobecne) povoľuje len a-z A-Z 0-9 / - ? : ( ) . , \' + a medzeru: diakritika môže spôsobiť odmietnutie importu.',
    mimoSady: (v, znaky) => '"' + v + '" obsahuje znak(y) mimo povolenej SEPA znakovej sady: ' + znaky + '.',
    pmtInfLimit: (i, n) => 'PmtInf[' + i + '] obsahuje ' + n + ' transakcií. Tatra banka povoľuje maximálne 500 transakcií v jednom bloku PmtInf ("Max. 500 transakcií v súbore"): súbor rozdeľte na viac blokov/súborov.',
    pmtInfLimitInde: (i, n) => 'PmtInf[' + i + '] obsahuje ' + n + ' transakcií. Tatra banka má zdokumentovaný limit 500 transakcií na blok: aj iné banky bežne obmedzujú veľkosť dávky, overte limit vašej banky.',
    pmtMtdZly: (i, v) => 'PmtInf[' + i + ']/PmtMtd je "' + v + '", musí byť "TRF" pre SEPA úhradu.',
    datumChyba: (i) => 'PmtInf[' + i + ']/ReqdExctnDt chýba. Toto pole je povinné.',
    datumFormat: (i, v) => 'PmtInf[' + i + ']/ReqdExctnDt "' + v + '" nie je platný dátum vo formáte YYYY-MM-DD.',
    datumMinulost: (i, v) => 'PmtInf[' + i + ']/ReqdExctnDt (' + v + ') je v minulosti. Banky spätný dátum požadovanej splatnosti neakceptujú.',
    datumDaleko: (i, v, dni, banka, max) => 'PmtInf[' + i + ']/ReqdExctnDt (' + v + ') je ' + dni + ' dní dopredu. ' + banka + ' akceptuje maximálne ' + max + ' dní vopred.',
    datumDalekoInde: (i, v, dni) => 'PmtInf[' + i + ']/ReqdExctnDt (' + v + ') je ' + dni + ' dní dopredu. Tatra banka aj VÚB majú zdokumentovaný limit 31, resp. 30 dní: overte limit vašej banky, ak nie je vybraná vyššie.',
    datumRozdielny: (i, v, prev) => 'PmtInf[' + i + ']/ReqdExctnDt (' + v + ') sa líši od predchádzajúceho bloku PmtInf (' + prev + '). Tatra banka vyžaduje rovnaký dátum pre všetky platby v súbore.',
    dbtrNmChyba: (i) => 'PmtInf[' + i + ']/Dbtr/Nm chýba. Meno platiteľa je povinné.',
    dbtrNmDlhy: (i, n) => 'PmtInf[' + i + ']/Dbtr/Nm má ' + n + ' znakov, maximum je 70.',
    dbtrIbanChyba: (i) => 'PmtInf[' + i + ']/DbtrAcct/Id/IBAN chýba. IBAN debetného účtu je povinný.',
    dbtrIbanZly: (i, v, dovod) => 'PmtInf[' + i + ']/DbtrAcct/Id/IBAN "' + v + '" nie je platný IBAN (' + dovod + ').',
    dbtrIbanMedzery: (i) => 'PmtInf[' + i + ']/DbtrAcct/Id/IBAN obsahuje medzery. IBAN v XML sa zapisuje bez medzier.',
    dbtrBicChyba: (i, tag, banka, bic) => 'PmtInf[' + i + ']/DbtrAgt/FinInstnId/' + tag + ' chýba. ' + (bic ? banka + ' vyžaduje presne "' + bic + '".' : 'Odporúčame BIC banky platiteľa vyplniť.'),
    dbtrBicNesedi: (i, tag, v, banka, bic) => 'PmtInf[' + i + ']/DbtrAgt/FinInstnId/' + tag + ' je "' + v + '", ale pre ' + banka + ' musí byť presne "' + bic + '". Súbor s účtom vedeným v inej banke bude bankou pri importe zamietnutý.',
    dbtrBicFormat: (i, tag, v) => 'PmtInf[' + i + ']/DbtrAgt/FinInstnId/' + tag + ' "' + v + '" nemá platný formát BIC (8 alebo 11 znakov).',
    pmtInfBezTx: (i) => 'PmtInf[' + i + '] neobsahuje žiadnu transakciu <CdtTrfTxInf>.',
    instrPrty: (tx, v) => tx + ': InstrPrty je "' + v + '". Pre SEPA úhradu musí byť "NORM": hodnota "HIGH" spôsobí, že banka platbu spracuje ako prioritnú/spoplatnenú, nie ako štandardnú SEPA úhradu.',
    svcLvlChyba: (tx) => tx + ': PmtTpInf/SvcLvl/Cd chýba (na úrovni PmtInf aj transakcie). Musí byť "SEPA".',
    svcLvlZly: (tx, v) => tx + ': PmtTpInf/SvcLvl/Cd je "' + v + '", musí byť "SEPA".',
    chrgBrChyba: (tx) => tx + ': ChrgBr chýba (na úrovni PmtInf aj transakcie). Pre SEPA úhradu musí byť "SLEV": bez neho ho banka síce zvyčajne doplní sama (VÚB), ale spoliehať sa na to nie je bezpečné naprieč bankami.',
    chrgBrZly: (tx, v) => tx + ': ChrgBr je "' + v + '", musí byť "SLEV" pre SEPA úhradu.',
    e2eChyba: (tx) => tx + ': PmtId/EndToEndId chýba. Toto pole je povinné a zároveň jediné miesto pre VS/ŠS/KS.',
    e2eDlhy: (tx, n) => tx + ': PmtId/EndToEndId má ' + n + ' znakov, maximum je 35.',
    symbolPoradie: (tx, v) => tx + ': EndToEndId "' + v + '" má VS/ŠS/KS v nesprávnom poradí. Konvencia NBS vyžaduje presne /VS/SS/KS: inak si protistrana platbu nevie automaticky spárovať s faktúrou (samotný prevod prejde v poriadku).',
    symbolDlhy: (tx, druh, v, n, max) => tx + ': EndToEndId: ' + druh + '="' + v + '" má ' + n + ' číslic, maximum je ' + max + '.',
    symbolNecislo: (tx, druh, v) => tx + ': EndToEndId: ' + druh + '="' + v + '" obsahuje nečíselné znaky. VS/ŠS/KS sú vždy len číslice.',
    e2eDuplicita: (tx, v, kde) => tx + ': EndToEndId "' + v + '" sa v súbore opakuje (prvýkrát v ' + kde + '). Duplicitné EndToEndId sťažujú párovanie platieb a niektoré banky ich odmietajú.',
    sumaChyba: (tx) => tx + ': Amt/InstdAmt chýba. Suma platby je povinná.',
    sumaMena: (tx, ccy) => tx + ': Amt/InstdAmt má menu "' + ccy + '", pre SEPA úhradu musí byť "EUR".',
    sumaFormat: (tx, v) => tx + ': Amt/InstdAmt "' + v + '" nemá platný formát čísla (očakáva sa napr. "450.00", bodka ako desatinný oddeľovač).',
    sumaNekladna: (tx, v) => tx + ': Amt/InstdAmt je ' + v + '. Suma platby musí byť kladná.',
    sumaDesatinne: (tx, v) => tx + ': Amt/InstdAmt "' + v + '" má viac ako 2 desatinné miesta. EUR sumy sa zapisujú s presne 2 desatinnými miestami.',
    cdtrNmChybaTatra: (tx) => tx + ': Cdtr/Nm chýba. Tatra banka ho pri spracovaní doplní z účtu príjemcu, ak je vedený v Tatra banke: ak nie, doplní hodnotu "NOTPROVIDED", čo protistrana uvidí namiesto skutočného mena.',
    cdtrNmChyba: (tx) => tx + ': Cdtr/Nm chýba. Meno príjemcu je povinné.',
    cdtrNmDlhy: (tx, n) => tx + ': Cdtr/Nm má ' + n + ' znakov, maximum je 70.',
    cdtrIbanChyba: (tx) => tx + ': CdtrAcct/Id/IBAN chýba. IBAN účtu príjemcu je povinný.',
    cdtrIbanZly: (tx, v, dovod) => tx + ': CdtrAcct/Id/IBAN "' + v + '" nie je platný IBAN (' + dovod + ').',
    cdtrIbanMod11: (tx, v, tatra) => tx + ': CdtrAcct/Id/IBAN "' + v + '" má platný medzinárodný kontrolný súčet (MOD-97), ale posledných 10 číslic neprejde slovenskou kontrolou modulo-11 na základné číslo účtu. ' + (tatra
      ? 'Tatra banka túto kontrolu vykonáva pri slovenských kreditných IBAN a platbu by zamietla.'
      : 'Túto dodatočnú kontrolu dokumentuje Tatra banka; pri inej banke overte, či ju tiež vykonáva.') + ' Skontrolujte prepis čísla účtu.',
    cdtrIbanMimoSepa: (tx, v, krajina) => tx + ': CdtrAcct/Id/IBAN "' + v + '" patrí krajine "' + krajina + '", ktorá nie je v SEPA priestore. SEPA úhrada mimo SEPA priestoru bude bankou spracovaná ako cezhraničná platba (iné poplatky) alebo odmietnutá.',
    cdtrBicPovinny: (tx, tag) => tx + ': CdtrAgt/FinInstnId/' + tag + ' chýba. VÚB vo vlastnej špecifikácii (Creditor Agent BIC, AT23) označuje toto pole ako povinné (Mandatory): na rozdiel od Tatra banky, ktorá ho vie odvodiť z IBAN.',
    cdtrBicMimoSepa: (tx, tag) => tx + ': CdtrAgt/FinInstnId/' + tag + ' chýba a IBAN príjemcu nepatrí do SEPA priestoru. Tatra banka BIC odvodí z IBAN len ak IBAN patrí banke zo SEPA priestoru: inak platbu zamietne.',
    cdtrBicFormat: (tx, tag, v) => tx + ': CdtrAgt/FinInstnId/' + tag + ' "' + v + '" nemá platný formát BIC (8 alebo 11 znakov).',
    cdtrBicNesediIban: (tx, tag, v, kod, odvodeny) => tx + ': CdtrAgt/FinInstnId/' + tag + ' "' + v + '" sa nezhoduje s bankou odvodenou z IBAN (kód banky ' + kod + ' → ' + odvodeny + '). Tatra banka porovnáva prvých 6 znakov zadaného a vypočítaného BIC: pri nezhode platbu zamietne.',
    viacUstrd: (tx, n) => tx + ': RmtInf obsahuje ' + n + ' elementov Ustrd. Povolená je iba jedna inštancia: nadbytočné banka pri spracovaní odstráni.',
    ustrdDlhy: (tx, n) => tx + ': RmtInf/Ustrd má ' + n + ' znakov, maximum je 140.',
    slspInstant: (tx) => tx + ': PmtTpInf/LclInstrm/Cd nie je nastavené. Ak má byť táto platba spracovaná ako okamžitá (instant), Business24 vyžaduje hodnotu "INST": bez nej sa platba spracuje ako bežná SEPA úhrada, bez chybového hlásenia.',
    pocetNesedi: (ocak, sk) => 'Očakávali ste ' + ocak + ' transakcií, súbor však obsahuje ' + sk + '. Skontrolujte, či ste nahrali správny/celý súbor, alebo či export z účtovníctva nevynechal/zdvojil platby.',
    suborVelky: (mb) => 'Súbor má približne ' + mb + ' MB. Veľmi veľké súbory môžu importný formulár banky spomaliť alebo prekročiť jeho limit: zvážte rozdelenie do viacerých súborov.',
    velaTransakcii: (n) => 'Súbor obsahuje ' + n + ' transakcií. Aj mimo Tatra banky (limit 500/PmtInf) je bežné, že banky obmedzujú veľkosť jednej dávky: pri veľkých súboroch overte limit vopred.',

    chkMsgId: 'GrpHdr/MsgId nie je vyplnené: nepovinné pre Tatra banku, no odporúčame vlastný jedinečný identifikátor súboru pre spätné dohľadanie.',
    chkNbOfTxs: (n) => 'GrpHdr/NbOfTxs nie je vyplnené: odporúčame doplniť presnú hodnotu ' + n + ', aj keď Tatra banka toto pole nevyžaduje, iné importy naň spoliehajú.',
    chkCtrlSum: (v) => 'GrpHdr/CtrlSum nie je vyplnené: odporúčame doplniť presnú hodnotu ' + v + '.',
    chkBicOdvodi: (banka, tx) => banka + ' vie CdtrAgt/BIC odvodiť z platného SEPA IBAN príjemcu (' + tx + '): chýbajúci BIC tu nie je chyba, len uistite sa, že IBAN je správny.',
    chkBicCsob: (tx) => 'ČSOB robí CdtrAgt/BIC od 1.2.2016 nepovinným pre SEPA platby (' + tx + '): chýbajúci BIC tu nie je chyba.',
    chkPoUprave: 'Po každej úprave XML spustite kontrolu znova: banka validuje súbor nanovo pri každom importe.',
    chkVerzia: 'Skontrolujte, že účtovný softvér (Pohoda, Money S3, KROS Omega, vlastný export...) generuje presne pain.001.001.03, nie novšiu verziu.',
    chkBezBanky: 'Bez vybranej konkrétnej banky sa neoverujú BIC banky, limit počtu transakcií ani okno dátumu splatnosti: vyberte banku pre presnejšiu diagnózu.',

    zhrnutiePass: (banka) => 'Žiadne problémy sa nenašli. Súbor vyzerá formátovo v poriadku pre ' + banka + '.',
    zhrnutieFail: (n, top) => n + ' blokujúc' + (n === 1 ? 'a chyba' : n < 5 ? 'e chyby' : 'ich chýb') + '. Najzávažnejšie: ' + top,
    zhrnutieWarn: (n, top) => 'Nič blokujúce, ale ' + n + ' vec' + (n === 1 ? '' : n < 5 ? 'i' : 'í') + ' stojí za opravu. Najvyššie: ' + top,
    pravnaPoznamka: 'Tento nástroj nie je banka a nič neoveruje voči vášmu skutočnému bankovému účtu ani voči systémom Tatra banky, SLSP, VÚB či ČSOB. Ide o čisto formátovú, klientskú kontrolu XML podľa verejne publikovaných špecifikácií týchto bánk a normy ISO 20022 / EPC SEPA Credit Transfer: nič z obsahu súboru sa nikam neodosiela. Čistý výsledok nie je zárukou, že banka platbu prijme; banky môžu svoje požiadavky kedykoľvek zmeniť.',
  },

  en: {
    strana: { Cdtr: 'of the creditor', Dbtr: 'of the debtor', UltmtCdtr: 'of the ultimate creditor', UltmtDbtr: 'of the ultimate debtor', InitgPty: 'of the initiating party', _: 'of a party to the payment' },
    chybaMestoKrajina: 'the town (TwnNm) or the country code (Ctry)',
    chybaMesto: 'the town (TwnNm)',
    chybaKrajina: 'the country code (Ctry)',
    ibanFormat: 'wrong format',
    ibanDlzka: (k) => 'wrong length for country ' + k,
    ibanSucet: 'MOD-97 checksum failed',
    prazdne: '(empty)',
    chybaHodnota: '(missing)',

    adresaNestrukturovana: (strana, po) => 'The address ' + strana + ' is written as free text in <AdrLine>. ' + (po
      ? 'Since 15 November 2026 the bank rejects such a file: the address must carry at least the town and the country code in their own fields.'
      : 'From 15 November 2026 the bank will reject such a file. The address must carry at least the town and the country code in their own fields; until then it passes, after that it does not.'),
    adresaBezMestaKrajiny: (strana, chyba) => 'The address ' + strana + ' has structured fields, but ' + chyba + ' is missing. From 15 November 2026 that is the mandatory minimum for every address in a SEPA payment.',
    adresaVelaRiadkov: (n) => 'A hybrid address may have at most two <AdrLine> lines, this one has ' + n + '. Move the street and number into <StrtNm> and <BldgNb>.',
    adresaZlyKodKrajiny: (k) => 'The country code "' + k + '" is not a two-letter ISO 3166-1 code. The bank will reject it.',

    xmlPrazdne: 'No XML content was pasted. Paste the whole pain.001 file you exported from your accounting software.',
    xmlZleFormovane: (prva, dalsich) => 'The XML is not well-formed: ' + prva + (dalsich ? ' (and ' + dalsich + ' more structural problems.)' : '') + ' The bank will reject such a file before it even reaches the payment content.',
    chybaDocument: 'The root <Document> element was not found in the file. This is not a valid pain.001 file (or the XML is damaged badly enough that the element cannot be located).',
    chybaXmlns: (ns) => 'The <Document> element has no namespace (xmlns). All four banks process pain.001.001.03 with the namespace "' + ns + '": without it the import may fail or be interpreted incorrectly.',
    verzia09Skoro: 'The file is pain.001.001.09. That is a correct and newer version, but as of today Slovak banks importing a batch payment normally expect pain.001.001.03. If the import fails, send the same file as .03; from 15 November 2026 it will be the other way round.',
    neznamyNs: (ns, novsia) => 'The namespace "' + ns + '" is neither pain.001.001.03 nor .09. ' + (novsia
      ? 'This looks like another pain.001 version that these banks do not support for batch imports'
      : 'Tatra banka, SLSP, VÚB and ČSOB process pain.001.001.03 for batch imports, moving to .09 from 15 November 2026') + ': a file with a different namespace will be rejected, or the import will fail with no clear reason.',
    verzia03PoTermine: 'The file is pain.001.001.03. You can meet the address rules that apply from 15 November 2026 in this version, but some banks are moving to pain.001.001.09 at that date and dropping the older one. Check in your online banking which version your bank still accepts.',
    chybaCstmr: '<Document> does not contain <CstmrCdtTrfInitn>. Without this element the file carries no payment to process.',
    chybaPmtInf: 'The file contains no <PmtInf> block. Without one there is nothing to process.',
    chybaTx: 'Not one <PmtInf> block contains a <CdtTrfTxInf> transaction. The file carries no payment.',
    msgIdDlhy: (n) => 'GrpHdr/MsgId is ' + n + ' characters, the maximum is 35 (Max35Text). The bank may truncate the value or reject the file.',
    msgIdZnaky: 'GrpHdr/MsgId contains characters outside the common SEPA character set (a-z A-Z 0-9 / - ? : ( ) . , \' + space). We recommend using only these characters to be safe across banks.',
    creDtTmZly: (v) => 'GrpHdr/CreDtTm "' + v + '" is not a valid ISO date/time (for example 2026-09-04T09:00:00).',
    nbOfTxsNesedi: (uv, sk) => 'GrpHdr/NbOfTxs states ' + uv + ', but the file contains ' + sk + ' <CdtTrfTxInf> transactions. A transaction-count mismatch is one of the most common reasons an import is rejected.',
    ctrlSumNesedi: (uv, sk) => 'GrpHdr/CtrlSum states ' + uv + ', but the sum of all InstdAmt amounts is ' + sk + '.',
    initgPtyVzor: (nm) => 'Tatra banka expects GrpHdr/InitgPty/Nm in the format [A-Za-z0-9]{1,10}/[A-Z]{2} (for example "ABC1234567/SK") when this field is filled in. The value "' + nm + '" does not match that pattern: the field is optional overall, so you may leave it out entirely.',
    diakritikaCsob: (v) => '"' + v + '" contains diacritics. ČSOB states explicitly that a SEPA XML file with diacritics cannot be imported into BusinessBanking Lite at all.',
    diakritikaVseobecne: (v) => '"' + v + '" contains diacritics. The SEPA XML character set (per ČSOB documentation, applies generally) allows only a-z A-Z 0-9 / - ? : ( ) . , \' + and space: diacritics can cause the import to be rejected.',
    mimoSady: (v, znaky) => '"' + v + '" contains character(s) outside the allowed SEPA character set: ' + znaky + '.',
    pmtInfLimit: (i, n) => 'PmtInf[' + i + '] contains ' + n + ' transactions. Tatra banka allows at most 500 transactions in one PmtInf block ("Max. 500 transactions per file"): split the file into more blocks or files.',
    pmtInfLimitInde: (i, n) => 'PmtInf[' + i + '] contains ' + n + ' transactions. Tatra banka documents a limit of 500 transactions per block: other banks commonly limit batch size too, check your bank\'s limit.',
    pmtMtdZly: (i, v) => 'PmtInf[' + i + ']/PmtMtd is "' + v + '", it must be "TRF" for a SEPA credit transfer.',
    datumChyba: (i) => 'PmtInf[' + i + ']/ReqdExctnDt is missing. This field is mandatory.',
    datumFormat: (i, v) => 'PmtInf[' + i + ']/ReqdExctnDt "' + v + '" is not a valid date in YYYY-MM-DD format.',
    datumMinulost: (i, v) => 'PmtInf[' + i + ']/ReqdExctnDt (' + v + ') is in the past. Banks do not accept a backdated requested execution date.',
    datumDaleko: (i, v, dni, banka, max) => 'PmtInf[' + i + ']/ReqdExctnDt (' + v + ') is ' + dni + ' days ahead. ' + banka + ' accepts at most ' + max + ' days in advance.',
    datumDalekoInde: (i, v, dni) => 'PmtInf[' + i + ']/ReqdExctnDt (' + v + ') is ' + dni + ' days ahead. Tatra banka and VÚB document limits of 31 and 30 days: check your bank\'s limit if it is not selected above.',
    datumRozdielny: (i, v, prev) => 'PmtInf[' + i + ']/ReqdExctnDt (' + v + ') differs from the previous PmtInf block (' + prev + '). Tatra banka requires the same date for every payment in the file.',
    dbtrNmChyba: (i) => 'PmtInf[' + i + ']/Dbtr/Nm is missing. The debtor name is mandatory.',
    dbtrNmDlhy: (i, n) => 'PmtInf[' + i + ']/Dbtr/Nm is ' + n + ' characters, the maximum is 70.',
    dbtrIbanChyba: (i) => 'PmtInf[' + i + ']/DbtrAcct/Id/IBAN is missing. The debit account IBAN is mandatory.',
    dbtrIbanZly: (i, v, dovod) => 'PmtInf[' + i + ']/DbtrAcct/Id/IBAN "' + v + '" is not a valid IBAN (' + dovod + ').',
    dbtrIbanMedzery: (i) => 'PmtInf[' + i + ']/DbtrAcct/Id/IBAN contains spaces. An IBAN in XML is written without spaces.',
    dbtrBicChyba: (i, tag, banka, bic) => 'PmtInf[' + i + ']/DbtrAgt/FinInstnId/' + tag + ' is missing. ' + (bic ? banka + ' requires exactly "' + bic + '".' : 'We recommend filling in the debtor bank BIC.'),
    dbtrBicNesedi: (i, tag, v, banka, bic) => 'PmtInf[' + i + ']/DbtrAgt/FinInstnId/' + tag + ' is "' + v + '", but for ' + banka + ' it must be exactly "' + bic + '". A file with an account held at another bank will be rejected on import.',
    dbtrBicFormat: (i, tag, v) => 'PmtInf[' + i + ']/DbtrAgt/FinInstnId/' + tag + ' "' + v + '" is not a valid BIC format (8 or 11 characters).',
    pmtInfBezTx: (i) => 'PmtInf[' + i + '] contains no <CdtTrfTxInf> transaction.',
    instrPrty: (tx, v) => tx + ': InstrPrty is "' + v + '". For a SEPA credit transfer it must be "NORM": the value "HIGH" makes the bank process the payment as a priority/chargeable one instead of a standard SEPA transfer.',
    svcLvlChyba: (tx) => tx + ': PmtTpInf/SvcLvl/Cd is missing (at both PmtInf and transaction level). It must be "SEPA".',
    svcLvlZly: (tx, v) => tx + ': PmtTpInf/SvcLvl/Cd is "' + v + '", it must be "SEPA".',
    chrgBrChyba: (tx) => tx + ': ChrgBr is missing (at both PmtInf and transaction level). For a SEPA credit transfer it must be "SLEV": banks usually fill it in themselves (VÚB does), but relying on that is not safe across banks.',
    chrgBrZly: (tx, v) => tx + ': ChrgBr is "' + v + '", it must be "SLEV" for a SEPA credit transfer.',
    e2eChyba: (tx) => tx + ': PmtId/EndToEndId is missing. This field is mandatory and it is also the only place for the Slovak VS/ŠS/KS symbols.',
    e2eDlhy: (tx, n) => tx + ': PmtId/EndToEndId is ' + n + ' characters, the maximum is 35.',
    symbolPoradie: (tx, v) => tx + ': EndToEndId "' + v + '" has VS/ŠS/KS in the wrong order. The NBS convention requires exactly /VS/SS/KS: otherwise the other side cannot match the payment to an invoice automatically (the transfer itself goes through fine).',
    symbolDlhy: (tx, druh, v, n, max) => tx + ': EndToEndId: ' + druh + '="' + v + '" has ' + n + ' digits, the maximum is ' + max + '.',
    symbolNecislo: (tx, druh, v) => tx + ': EndToEndId: ' + druh + '="' + v + '" contains non-numeric characters. VS/ŠS/KS are always digits only.',
    e2eDuplicita: (tx, v, kde) => tx + ': EndToEndId "' + v + '" repeats in the file (first seen in ' + kde + '). Duplicate EndToEndId values make payment matching harder and some banks reject them.',
    sumaChyba: (tx) => tx + ': Amt/InstdAmt is missing. The payment amount is mandatory.',
    sumaMena: (tx, ccy) => tx + ': Amt/InstdAmt has currency "' + ccy + '", for a SEPA credit transfer it must be "EUR".',
    sumaFormat: (tx, v) => tx + ': Amt/InstdAmt "' + v + '" is not a valid number format (expected for example "450.00", with a dot as the decimal separator).',
    sumaNekladna: (tx, v) => tx + ': Amt/InstdAmt is ' + v + '. The payment amount must be positive.',
    sumaDesatinne: (tx, v) => tx + ': Amt/InstdAmt "' + v + '" has more than 2 decimal places. EUR amounts are written with exactly 2 decimal places.',
    cdtrNmChybaTatra: (tx) => tx + ': Cdtr/Nm is missing. Tatra banka fills it in from the creditor account if that account is held at Tatra banka: if not, it fills in "NOTPROVIDED", which the other side sees instead of the real name.',
    cdtrNmChyba: (tx) => tx + ': Cdtr/Nm is missing. The creditor name is mandatory.',
    cdtrNmDlhy: (tx, n) => tx + ': Cdtr/Nm is ' + n + ' characters, the maximum is 70.',
    cdtrIbanChyba: (tx) => tx + ': CdtrAcct/Id/IBAN is missing. The creditor account IBAN is mandatory.',
    cdtrIbanZly: (tx, v, dovod) => tx + ': CdtrAcct/Id/IBAN "' + v + '" is not a valid IBAN (' + dovod + ').',
    cdtrIbanMod11: (tx, v, tatra) => tx + ': CdtrAcct/Id/IBAN "' + v + '" has a valid international checksum (MOD-97), but the last 10 digits fail the Slovak modulo-11 check on the basic account number. ' + (tatra
      ? 'Tatra banka runs this check on Slovak creditor IBANs and would reject the payment.'
      : 'Tatra banka documents this additional check; with another bank, verify whether it runs it too.') + ' Check the account number for a typo.',
    cdtrIbanMimoSepa: (tx, v, krajina) => tx + ': CdtrAcct/Id/IBAN "' + v + '" belongs to country "' + krajina + '", which is not in the SEPA area. A SEPA credit transfer outside the SEPA area will be processed as a cross-border payment (different fees) or rejected.',
    cdtrBicPovinny: (tx, tag) => tx + ': CdtrAgt/FinInstnId/' + tag + ' is missing. VÚB marks this field as Mandatory in its own specification (Creditor Agent BIC, AT23): unlike Tatra banka, which can derive it from the IBAN.',
    cdtrBicMimoSepa: (tx, tag) => tx + ': CdtrAgt/FinInstnId/' + tag + ' is missing and the creditor IBAN is not in the SEPA area. Tatra banka derives the BIC from the IBAN only when the IBAN belongs to a bank in the SEPA area: otherwise it rejects the payment.',
    cdtrBicFormat: (tx, tag, v) => tx + ': CdtrAgt/FinInstnId/' + tag + ' "' + v + '" is not a valid BIC format (8 or 11 characters).',
    cdtrBicNesediIban: (tx, tag, v, kod, odvodeny) => tx + ': CdtrAgt/FinInstnId/' + tag + ' "' + v + '" does not match the bank derived from the IBAN (bank code ' + kod + ' → ' + odvodeny + '). Tatra banka compares the first 6 characters of the given and the computed BIC: on a mismatch it rejects the payment.',
    viacUstrd: (tx, n) => tx + ': RmtInf contains ' + n + ' Ustrd elements. Only one instance is allowed: the bank strips the extras during processing.',
    ustrdDlhy: (tx, n) => tx + ': RmtInf/Ustrd is ' + n + ' characters, the maximum is 140.',
    slspInstant: (tx) => tx + ': PmtTpInf/LclInstrm/Cd is not set. If this payment is meant to be processed as an instant transfer, Business24 requires the value "INST": without it the payment is processed as a normal SEPA transfer, with no error message.',
    pocetNesedi: (ocak, sk) => 'You expected ' + ocak + ' transactions, but the file contains ' + sk + '. Check that you uploaded the right and complete file, or whether the accounting export skipped or duplicated payments.',
    suborVelky: (mb) => 'The file is roughly ' + mb + ' MB. Very large files can slow down the bank\'s import form or exceed its limit: consider splitting them.',
    velaTransakcii: (n) => 'The file contains ' + n + ' transactions. Beyond Tatra banka (500 per PmtInf), banks commonly limit batch size: with large files, check the limit in advance.',

    chkMsgId: 'GrpHdr/MsgId is empty: optional for Tatra banka, but we recommend your own unique file identifier so the file can be traced later.',
    chkNbOfTxs: (n) => 'GrpHdr/NbOfTxs is empty: we recommend filling in the exact value ' + n + '; Tatra banka does not require this field, but other imports rely on it.',
    chkCtrlSum: (v) => 'GrpHdr/CtrlSum is empty: we recommend filling in the exact value ' + v + '.',
    chkBicOdvodi: (banka, tx) => banka + ' can derive CdtrAgt/BIC from a valid SEPA creditor IBAN (' + tx + '): a missing BIC is not an error here, just make sure the IBAN is right.',
    chkBicCsob: (tx) => 'ČSOB has made CdtrAgt/BIC optional for SEPA payments since 1 February 2016 (' + tx + '): a missing BIC is not an error here.',
    chkPoUprave: 'Run the check again after every edit to the XML: the bank validates the file afresh on each import.',
    chkVerzia: 'Check that your accounting software (Pohoda, Money S3, KROS Omega, a custom export…) generates exactly pain.001.001.03, not a newer version.',
    chkBezBanky: 'With no specific bank selected, the bank BIC, the transaction-count limit and the execution-date window are not verified: pick a bank for a more precise diagnosis.',

    zhrnutiePass: (banka) => 'No problems found. The file looks format-wise fine for ' + banka + '.',
    zhrnutieFail: (n, top) => n + (n === 1 ? ' blocking error' : ' blocking errors') + '. Most serious: ' + top,
    zhrnutieWarn: (n, top) => 'Nothing blocking, but ' + n + (n === 1 ? ' thing is' : ' things are') + ' worth fixing. Top of the list: ' + top,
    pravnaPoznamka: 'This tool is not a bank and verifies nothing against your real bank account or against the systems of Tatra banka, SLSP, VÚB or ČSOB. It is a purely format-level, client-side check of the XML against the publicly published specifications of these banks and the ISO 20022 / EPC SEPA Credit Transfer standard: nothing from the file content is sent anywhere. A clean result is no guarantee that the bank will accept the payment; banks can change their requirements at any time.',
  },

  de: {
    strana: { Cdtr: 'des Zahlungsempfängers', Dbtr: 'des Auftraggebers', UltmtCdtr: 'des endgültigen Zahlungsempfängers', UltmtDbtr: 'des endgültigen Auftraggebers', InitgPty: 'des Einreichers', _: 'einer Zahlungspartei' },
    chybaMestoKrajina: 'der Ort (TwnNm) und der Ländercode (Ctry)',
    chybaMesto: 'der Ort (TwnNm)',
    chybaKrajina: 'der Ländercode (Ctry)',
    ibanFormat: 'falsches Format',
    ibanDlzka: (k) => 'falsche Länge für das Land ' + k,
    ibanSucet: 'MOD-97-Prüfsumme fehlgeschlagen',
    prazdne: '(leer)',
    chybaHodnota: '(fehlt)',

    adresaNestrukturovana: (strana, po) => 'Die Adresse ' + strana + ' steht als Freitext in <AdrLine>. ' + (po
      ? 'Seit dem 15. November 2026 weist die Bank eine solche Datei zurück: die Adresse muss mindestens Ort und Ländercode in eigenen Feldern führen.'
      : 'Ab dem 15. November 2026 weist die Bank eine solche Datei zurück. Die Adresse muss mindestens Ort und Ländercode in eigenen Feldern führen; bis dahin geht sie durch, danach nicht mehr.'),
    adresaBezMestaKrajiny: (strana, chyba) => 'Die Adresse ' + strana + ' hat strukturierte Felder, es fehlt aber ' + chyba + '. Ab dem 15. November 2026 ist das das Pflichtminimum für jede Adresse in einer SEPA-Zahlung.',
    adresaVelaRiadkov: (n) => 'Eine hybride Adresse darf höchstens zwei <AdrLine>-Zeilen haben, diese hat ' + n + '. Verschieben Sie Straße und Hausnummer nach <StrtNm> und <BldgNb>.',
    adresaZlyKodKrajiny: (k) => 'Der Ländercode "' + k + '" ist kein zweibuchstabiger Code nach ISO 3166-1. Die Bank weist ihn zurück.',

    xmlPrazdne: 'Es wurde kein XML-Inhalt eingefügt. Fügen Sie die vollständige pain.001-Datei ein, die Sie aus Ihrer Buchhaltungssoftware exportiert haben.',
    xmlZleFormovane: (prva, dalsich) => 'Das XML ist nicht wohlgeformt: ' + prva + (dalsich ? ' (und ' + dalsich + ' weitere Strukturprobleme.)' : '') + ' Die Bank weist eine solche Datei zurück, bevor sie überhaupt zum Zahlungsinhalt kommt.',
    chybaDocument: 'Das Wurzelelement <Document> wurde in der Datei nicht gefunden. Das ist keine gültige pain.001-Datei (oder das XML ist so beschädigt, dass sich das Element nicht finden lässt).',
    chybaXmlns: (ns) => 'Das Element <Document> hat keinen Namensraum (xmlns). Alle vier Banken verarbeiten pain.001.001.03 mit dem Namensraum "' + ns + '": ohne ihn kann der Import scheitern oder falsch interpretiert werden.',
    verzia09Skoro: 'Die Datei ist pain.001.001.09. Das ist eine korrekte und neuere Version, aber slowakische Banken erwarten beim Import eines Sammelauftrags derzeit üblicherweise pain.001.001.03. Falls der Import scheitert, senden Sie dieselbe Datei als .03; ab dem 15. November 2026 ist es umgekehrt.',
    neznamyNs: (ns, novsia) => 'Der Namensraum "' + ns + '" ist weder pain.001.001.03 noch .09. ' + (novsia
      ? 'Das sieht nach einer anderen pain.001-Version aus, die diese Banken beim Sammelimport nicht unterstützen'
      : 'Tatra banka, SLSP, VÚB und ČSOB verarbeiten beim Sammelimport pain.001.001.03, ab dem 15. November 2026 nach und nach .09') + ': eine Datei mit anderem Namensraum weist die Bank zurück, oder der Import scheitert ohne klaren Grund.',
    verzia03PoTermine: 'Die Datei ist pain.001.001.03. Die ab dem 15. November 2026 geltenden Adressregeln können Sie darin erfüllen, ein Teil der Banken wechselt zu diesem Termin aber auf pain.001.001.09 und nimmt die ältere Version nicht mehr an. Prüfen Sie im Online-Banking, welche Version Ihre Bank noch akzeptiert.',
    chybaCstmr: '<Document> enthält kein <CstmrCdtTrfInitn>. Ohne dieses Element trägt die Datei keine Zahlung zur Verarbeitung.',
    chybaPmtInf: 'Die Datei enthält keinen <PmtInf>-Block. Ohne ihn gibt es nichts zu verarbeiten.',
    chybaTx: 'Kein einziger <PmtInf>-Block enthält eine <CdtTrfTxInf>-Transaktion. Die Datei überträgt keine Zahlung.',
    msgIdDlhy: (n) => 'GrpHdr/MsgId hat ' + n + ' Zeichen, das Maximum ist 35 (Max35Text). Die Bank kann den Wert kürzen oder die Datei zurückweisen.',
    msgIdZnaky: 'GrpHdr/MsgId enthält Zeichen außerhalb des üblichen SEPA-Zeichensatzes (a-z A-Z 0-9 / - ? : ( ) . , \' + Leerzeichen). Wir empfehlen, bankübergreifend nur diese Zeichen zu verwenden.',
    creDtTmZly: (v) => 'GrpHdr/CreDtTm "' + v + '" ist kein gültiges ISO-Datum bzw. keine gültige Uhrzeit (zum Beispiel 2026-09-04T09:00:00).',
    nbOfTxsNesedi: (uv, sk) => 'GrpHdr/NbOfTxs nennt ' + uv + ', die Datei enthält aber ' + sk + ' <CdtTrfTxInf>-Transaktionen. Eine abweichende Transaktionszahl gehört zu den häufigsten Gründen für eine Zurückweisung.',
    ctrlSumNesedi: (uv, sk) => 'GrpHdr/CtrlSum nennt ' + uv + ', die Summe aller InstdAmt-Beträge ist aber ' + sk + '.',
    initgPtyVzor: (nm) => 'Tatra banka erwartet GrpHdr/InitgPty/Nm im Format [A-Za-z0-9]{1,10}/[A-Z]{2} (zum Beispiel "ABC1234567/SK"), wenn dieses Feld gefüllt ist. Der Wert "' + nm + '" entspricht diesem Muster nicht: das Feld ist insgesamt optional, Sie können es also auch ganz weglassen.',
    diakritikaCsob: (v) => '"' + v + '" enthält diakritische Zeichen. ČSOB gibt ausdrücklich an, dass sich eine SEPA-XML-Datei mit diakritischen Zeichen gar nicht in BusinessBanking Lite importieren lässt.',
    diakritikaVseobecne: (v) => '"' + v + '" enthält diakritische Zeichen. Der SEPA-XML-Zeichensatz (laut ČSOB-Dokumentation, allgemein gültig) erlaubt nur a-z A-Z 0-9 / - ? : ( ) . , \' + und Leerzeichen: diakritische Zeichen können zur Zurückweisung des Imports führen.',
    mimoSady: (v, znaky) => '"' + v + '" enthält Zeichen außerhalb des erlaubten SEPA-Zeichensatzes: ' + znaky + '.',
    pmtInfLimit: (i, n) => 'PmtInf[' + i + '] enthält ' + n + ' Transaktionen. Tatra banka erlaubt höchstens 500 Transaktionen in einem PmtInf-Block ("Max. 500 Transaktionen je Datei"): teilen Sie die Datei in mehrere Blöcke oder Dateien.',
    pmtInfLimitInde: (i, n) => 'PmtInf[' + i + '] enthält ' + n + ' Transaktionen. Tatra banka dokumentiert ein Limit von 500 Transaktionen je Block: auch andere Banken begrenzen die Stapelgröße üblicherweise, prüfen Sie das Limit Ihrer Bank.',
    pmtMtdZly: (i, v) => 'PmtInf[' + i + ']/PmtMtd ist "' + v + '", für eine SEPA-Überweisung muss es "TRF" sein.',
    datumChyba: (i) => 'PmtInf[' + i + ']/ReqdExctnDt fehlt. Dieses Feld ist Pflicht.',
    datumFormat: (i, v) => 'PmtInf[' + i + ']/ReqdExctnDt "' + v + '" ist kein gültiges Datum im Format YYYY-MM-DD.',
    datumMinulost: (i, v) => 'PmtInf[' + i + ']/ReqdExctnDt (' + v + ') liegt in der Vergangenheit. Banken akzeptieren kein rückdatiertes Ausführungsdatum.',
    datumDaleko: (i, v, dni, banka, max) => 'PmtInf[' + i + ']/ReqdExctnDt (' + v + ') liegt ' + dni + ' Tage in der Zukunft. ' + banka + ' akzeptiert höchstens ' + max + ' Tage im Voraus.',
    datumDalekoInde: (i, v, dni) => 'PmtInf[' + i + ']/ReqdExctnDt (' + v + ') liegt ' + dni + ' Tage in der Zukunft. Tatra banka und VÚB dokumentieren Limits von 31 bzw. 30 Tagen: prüfen Sie das Limit Ihrer Bank, wenn sie oben nicht ausgewählt ist.',
    datumRozdielny: (i, v, prev) => 'PmtInf[' + i + ']/ReqdExctnDt (' + v + ') weicht vom vorherigen PmtInf-Block (' + prev + ') ab. Tatra banka verlangt dasselbe Datum für alle Zahlungen in der Datei.',
    dbtrNmChyba: (i) => 'PmtInf[' + i + ']/Dbtr/Nm fehlt. Der Name des Auftraggebers ist Pflicht.',
    dbtrNmDlhy: (i, n) => 'PmtInf[' + i + ']/Dbtr/Nm hat ' + n + ' Zeichen, das Maximum ist 70.',
    dbtrIbanChyba: (i) => 'PmtInf[' + i + ']/DbtrAcct/Id/IBAN fehlt. Die IBAN des Belastungskontos ist Pflicht.',
    dbtrIbanZly: (i, v, dovod) => 'PmtInf[' + i + ']/DbtrAcct/Id/IBAN "' + v + '" ist keine gültige IBAN (' + dovod + ').',
    dbtrIbanMedzery: (i) => 'PmtInf[' + i + ']/DbtrAcct/Id/IBAN enthält Leerzeichen. Eine IBAN wird im XML ohne Leerzeichen geschrieben.',
    dbtrBicChyba: (i, tag, banka, bic) => 'PmtInf[' + i + ']/DbtrAgt/FinInstnId/' + tag + ' fehlt. ' + (bic ? banka + ' verlangt exakt "' + bic + '".' : 'Wir empfehlen, die BIC der Auftraggeberbank anzugeben.'),
    dbtrBicNesedi: (i, tag, v, banka, bic) => 'PmtInf[' + i + ']/DbtrAgt/FinInstnId/' + tag + ' ist "' + v + '", für ' + banka + ' muss es aber exakt "' + bic + '" sein. Eine Datei mit einem Konto bei einer anderen Bank wird beim Import zurückgewiesen.',
    dbtrBicFormat: (i, tag, v) => 'PmtInf[' + i + ']/DbtrAgt/FinInstnId/' + tag + ' "' + v + '" hat kein gültiges BIC-Format (8 oder 11 Zeichen).',
    pmtInfBezTx: (i) => 'PmtInf[' + i + '] enthält keine <CdtTrfTxInf>-Transaktion.',
    instrPrty: (tx, v) => tx + ': InstrPrty ist "' + v + '". Für eine SEPA-Überweisung muss es "NORM" sein: der Wert "HIGH" führt dazu, dass die Bank die Zahlung als eilige, gebührenpflichtige Zahlung verarbeitet und nicht als normale SEPA-Überweisung.',
    svcLvlChyba: (tx) => tx + ': PmtTpInf/SvcLvl/Cd fehlt (sowohl auf PmtInf- als auch auf Transaktionsebene). Es muss "SEPA" sein.',
    svcLvlZly: (tx, v) => tx + ': PmtTpInf/SvcLvl/Cd ist "' + v + '", es muss "SEPA" sein.',
    chrgBrChyba: (tx) => tx + ': ChrgBr fehlt (sowohl auf PmtInf- als auch auf Transaktionsebene). Für eine SEPA-Überweisung muss es "SLEV" sein: Banken ergänzen es zwar meist selbst (VÚB tut das), darauf zu bauen ist bankübergreifend aber nicht sicher.',
    chrgBrZly: (tx, v) => tx + ': ChrgBr ist "' + v + '", für eine SEPA-Überweisung muss es "SLEV" sein.',
    e2eChyba: (tx) => tx + ': PmtId/EndToEndId fehlt. Dieses Feld ist Pflicht und zugleich der einzige Platz für die slowakischen Symbole VS/ŠS/KS.',
    e2eDlhy: (tx, n) => tx + ': PmtId/EndToEndId hat ' + n + ' Zeichen, das Maximum ist 35.',
    symbolPoradie: (tx, v) => tx + ': EndToEndId "' + v + '" hat VS/ŠS/KS in der falschen Reihenfolge. Die NBS-Konvention verlangt exakt /VS/SS/KS: sonst kann die Gegenseite die Zahlung nicht automatisch einer Rechnung zuordnen (die Überweisung selbst geht in Ordnung durch).',
    symbolDlhy: (tx, druh, v, n, max) => tx + ': EndToEndId: ' + druh + '="' + v + '" hat ' + n + ' Ziffern, das Maximum ist ' + max + '.',
    symbolNecislo: (tx, druh, v) => tx + ': EndToEndId: ' + druh + '="' + v + '" enthält nicht-numerische Zeichen. VS/ŠS/KS bestehen immer nur aus Ziffern.',
    e2eDuplicita: (tx, v, kde) => tx + ': EndToEndId "' + v + '" wiederholt sich in der Datei (erstmals in ' + kde + '). Doppelte EndToEndId erschweren den Zahlungsabgleich und werden von manchen Banken zurückgewiesen.',
    sumaChyba: (tx) => tx + ': Amt/InstdAmt fehlt. Der Zahlungsbetrag ist Pflicht.',
    sumaMena: (tx, ccy) => tx + ': Amt/InstdAmt hat die Währung "' + ccy + '", für eine SEPA-Überweisung muss es "EUR" sein.',
    sumaFormat: (tx, v) => tx + ': Amt/InstdAmt "' + v + '" hat kein gültiges Zahlenformat (erwartet wird zum Beispiel "450.00", mit Punkt als Dezimaltrennzeichen).',
    sumaNekladna: (tx, v) => tx + ': Amt/InstdAmt ist ' + v + '. Der Zahlungsbetrag muss positiv sein.',
    sumaDesatinne: (tx, v) => tx + ': Amt/InstdAmt "' + v + '" hat mehr als 2 Nachkommastellen. EUR-Beträge werden mit genau 2 Nachkommastellen geschrieben.',
    cdtrNmChybaTatra: (tx) => tx + ': Cdtr/Nm fehlt. Tatra banka ergänzt ihn bei der Verarbeitung aus dem Empfängerkonto, sofern dieses bei Tatra banka geführt wird: sonst setzt sie "NOTPROVIDED" ein, was die Gegenseite anstelle des echten Namens sieht.',
    cdtrNmChyba: (tx) => tx + ': Cdtr/Nm fehlt. Der Name des Zahlungsempfängers ist Pflicht.',
    cdtrNmDlhy: (tx, n) => tx + ': Cdtr/Nm hat ' + n + ' Zeichen, das Maximum ist 70.',
    cdtrIbanChyba: (tx) => tx + ': CdtrAcct/Id/IBAN fehlt. Die IBAN des Empfängerkontos ist Pflicht.',
    cdtrIbanZly: (tx, v, dovod) => tx + ': CdtrAcct/Id/IBAN "' + v + '" ist keine gültige IBAN (' + dovod + ').',
    cdtrIbanMod11: (tx, v, tatra) => tx + ': CdtrAcct/Id/IBAN "' + v + '" hat eine gültige internationale Prüfsumme (MOD-97), die letzten 10 Ziffern bestehen aber die slowakische Modulo-11-Prüfung der Grundkontonummer nicht. ' + (tatra
      ? 'Tatra banka führt diese Prüfung bei slowakischen Empfänger-IBANs durch und würde die Zahlung zurückweisen.'
      : 'Diese zusätzliche Prüfung dokumentiert Tatra banka; prüfen Sie bei einer anderen Bank, ob sie sie ebenfalls durchführt.') + ' Prüfen Sie die Kontonummer auf einen Tippfehler.',
    cdtrIbanMimoSepa: (tx, v, krajina) => tx + ': CdtrAcct/Id/IBAN "' + v + '" gehört zum Land "' + krajina + '", das nicht im SEPA-Raum liegt. Eine SEPA-Überweisung außerhalb des SEPA-Raums verarbeitet die Bank als grenzüberschreitende Zahlung (andere Gebühren) oder weist sie zurück.',
    cdtrBicPovinny: (tx, tag) => tx + ': CdtrAgt/FinInstnId/' + tag + ' fehlt. VÚB kennzeichnet dieses Feld in der eigenen Spezifikation als Pflichtfeld (Creditor Agent BIC, AT23): anders als Tatra banka, die es aus der IBAN ableiten kann.',
    cdtrBicMimoSepa: (tx, tag) => tx + ': CdtrAgt/FinInstnId/' + tag + ' fehlt und die Empfänger-IBAN liegt nicht im SEPA-Raum. Tatra banka leitet die BIC nur dann aus der IBAN ab, wenn die IBAN zu einer Bank im SEPA-Raum gehört: sonst weist sie die Zahlung zurück.',
    cdtrBicFormat: (tx, tag, v) => tx + ': CdtrAgt/FinInstnId/' + tag + ' "' + v + '" hat kein gültiges BIC-Format (8 oder 11 Zeichen).',
    cdtrBicNesediIban: (tx, tag, v, kod, odvodeny) => tx + ': CdtrAgt/FinInstnId/' + tag + ' "' + v + '" passt nicht zu der aus der IBAN abgeleiteten Bank (Bankleitzahl ' + kod + ' → ' + odvodeny + '). Tatra banka vergleicht die ersten 6 Zeichen der angegebenen und der berechneten BIC: bei Abweichung weist sie die Zahlung zurück.',
    viacUstrd: (tx, n) => tx + ': RmtInf enthält ' + n + ' Ustrd-Elemente. Erlaubt ist nur eine Instanz: die überzähligen entfernt die Bank bei der Verarbeitung.',
    ustrdDlhy: (tx, n) => tx + ': RmtInf/Ustrd hat ' + n + ' Zeichen, das Maximum ist 140.',
    slspInstant: (tx) => tx + ': PmtTpInf/LclInstrm/Cd ist nicht gesetzt. Soll diese Zahlung als Echtzeitüberweisung verarbeitet werden, verlangt Business24 den Wert "INST": ohne ihn wird die Zahlung ohne Fehlermeldung als normale SEPA-Überweisung verarbeitet.',
    pocetNesedi: (ocak, sk) => 'Sie haben ' + ocak + ' Transaktionen erwartet, die Datei enthält aber ' + sk + '. Prüfen Sie, ob Sie die richtige und vollständige Datei hochgeladen haben, oder ob der Buchhaltungsexport Zahlungen ausgelassen oder verdoppelt hat.',
    suborVelky: (mb) => 'Die Datei ist etwa ' + mb + ' MB groß. Sehr große Dateien können das Importformular der Bank verlangsamen oder dessen Limit überschreiten: erwägen Sie eine Aufteilung.',
    velaTransakcii: (n) => 'Die Datei enthält ' + n + ' Transaktionen. Auch außerhalb von Tatra banka (500 je PmtInf) begrenzen Banken die Stapelgröße üblicherweise: prüfen Sie das Limit bei großen Dateien vorab.',

    chkMsgId: 'GrpHdr/MsgId ist leer: für Tatra banka optional, wir empfehlen aber eine eigene eindeutige Dateikennung, damit sich die Datei später nachvollziehen lässt.',
    chkNbOfTxs: (n) => 'GrpHdr/NbOfTxs ist leer: wir empfehlen, den exakten Wert ' + n + ' einzutragen; Tatra banka verlangt dieses Feld nicht, andere Importe verlassen sich darauf.',
    chkCtrlSum: (v) => 'GrpHdr/CtrlSum ist leer: wir empfehlen, den exakten Wert ' + v + ' einzutragen.',
    chkBicOdvodi: (banka, tx) => banka + ' kann CdtrAgt/BIC aus einer gültigen SEPA-Empfänger-IBAN ableiten (' + tx + '): eine fehlende BIC ist hier kein Fehler, stellen Sie nur sicher, dass die IBAN stimmt.',
    chkBicCsob: (tx) => 'ČSOB hat CdtrAgt/BIC für SEPA-Zahlungen zum 1. Februar 2016 optional gemacht (' + tx + '): eine fehlende BIC ist hier kein Fehler.',
    chkPoUprave: 'Führen Sie die Prüfung nach jeder Änderung am XML erneut aus: die Bank validiert die Datei bei jedem Import neu.',
    chkVerzia: 'Prüfen Sie, ob Ihre Buchhaltungssoftware (Pohoda, Money S3, KROS Omega, ein eigener Export…) genau pain.001.001.03 erzeugt und keine neuere Version.',
    chkBezBanky: 'Ohne ausgewählte Bank werden die Bank-BIC, das Transaktionslimit und das Fenster für das Ausführungsdatum nicht geprüft: wählen Sie eine Bank für eine genauere Diagnose.',

    zhrnutiePass: (banka) => 'Keine Probleme gefunden. Die Datei sieht formatseitig für ' + banka + ' in Ordnung aus.',
    zhrnutieFail: (n, top) => n + (n === 1 ? ' blockierender Fehler' : ' blockierende Fehler') + '. Am schwerwiegendsten: ' + top,
    zhrnutieWarn: (n, top) => 'Nichts Blockierendes, aber ' + n + (n === 1 ? ' Sache ist' : ' Sachen sind') + ' eine Korrektur wert. Ganz oben: ' + top,
    pravnaPoznamka: 'Dieses Werkzeug ist keine Bank und prüft nichts gegen Ihr echtes Bankkonto oder gegen die Systeme von Tatra banka, SLSP, VÚB oder ČSOB. Es ist eine rein formatbezogene Prüfung des XML im Browser, anhand der öffentlich veröffentlichten Spezifikationen dieser Banken und der Norm ISO 20022 / EPC SEPA Credit Transfer: nichts vom Inhalt der Datei wird irgendwohin gesendet. Ein sauberes Ergebnis ist keine Garantie dafür, dass die Bank die Zahlung annimmt; Banken können ihre Anforderungen jederzeit ändern.',
  },
};

function slovnikPre(lang) {
  const l = typeof lang === 'string' ? lang.slice(0, 2).toLowerCase() : 'sk';
  return SPRAVY[l] || SPRAVY.sk;
}

function safeStr(v) {
  return typeof v === 'string' ? v : '';
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// ───────────────────────── tolerant XML → tree parser ─────────────────────
// Deliberately not DOMParser (unavailable in Node, and we want byte-for-byte
// identical behaviour in the browser and in tests.mjs). Handles elements,
// attributes, text, CDATA, comments, and the XML declaration / DOCTYPE
// (skipped). Tracks well-formedness (unclosed / mismatched tags) without
// giving up on the rest of the document: a bank's own import will refuse a
// malformed file outright, but we still want to report every other problem
// we can find in what we did manage to parse.

const ENTITY_MAP = { amp: '&', lt: '<', gt: '>', apos: "'", quot: '"' };

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENTITY_MAP, body) ? ENTITY_MAP[body] : m;
  });
}

function localName(tag) {
  const i = tag.lastIndexOf(':');
  return i === -1 ? tag : tag.slice(i + 1);
}

function parseAttrs(str) {
  const attrs = {};
  const re = /([^\s=\/]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(str))) {
    attrs[m[1]] = decodeEntities(m[3] !== undefined ? m[3] : m[4]);
  }
  return attrs;
}

function makeNode(tag, attrs, parent) {
  return { tag: localName(tag), rawTag: tag, attrs: attrs || {}, children: [], parent: parent || null };
}

function parseXml(text) {
  const src = safeStr(text).replace(/^\uFEFF/, '');
  const errors = [];
  const root = makeNode('#root', {}, null);
  let current = root;
  const stack = [root];
  let i = 0;
  const len = src.length;
  let sawAnyElement = false;

  while (i < len) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      const text = src.slice(i);
      if (text.trim()) current.children.push({ type: 'text', text: decodeEntities(text) });
      break;
    }
    if (lt > i) {
      const text = src.slice(i, lt);
      if (text.trim()) current.children.push({ type: 'text', text: decodeEntities(text) });
    }

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? len : end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      const content = end === -1 ? src.slice(lt + 9) : src.slice(lt + 9, end);
      current.children.push({ type: 'text', text: content });
      i = end === -1 ? len : end + 3;
      continue;
    }
    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2);
      i = end === -1 ? len : end + 2;
      continue;
    }
    if (src.startsWith('<!', lt)) {
      // DOCTYPE or similar: skip to next '>' (no nested-bracket support, fine for pain.001 files)
      const end = src.indexOf('>', lt + 2);
      i = end === -1 ? len : end + 1;
      continue;
    }

    // find end of this tag, respecting quoted attribute values
    let j = lt + 1;
    let inQuote = null;
    while (j < len) {
      const c = src[j];
      if (inQuote) {
        if (c === inQuote) inQuote = null;
      } else if (c === '"' || c === "'") {
        inQuote = c;
      } else if (c === '>') {
        break;
      }
      j++;
    }
    if (j >= len) {
      errors.push('Nezatvorený tag na pozícii ' + lt + ' (chýba ">").');
      break;
    }
    const inner = src.slice(lt + 1, j);
    i = j + 1;

    if (inner.startsWith('/')) {
      const closeName = inner.slice(1).trim();
      // pop stack looking for a matching open tag (tolerant of a bad nesting)
      let foundIdx = -1;
      for (let k = stack.length - 1; k >= 1; k--) {
        if (stack[k].rawTag === closeName) { foundIdx = k; break; }
      }
      if (foundIdx === -1) {
        errors.push(`Zatvárací tag </${closeName}> nemá zodpovedajúci otvárací tag.`);
      } else {
        if (foundIdx !== stack.length - 1) {
          errors.push(`Tag <${stack[stack.length - 1].rawTag}> nebol správne zatvorený pred </${closeName}>.`);
        }
        stack.length = foundIdx;
        current = stack[stack.length - 1];
      }
      continue;
    }

    const selfClosing = inner.endsWith('/');
    const body = (selfClosing ? inner.slice(0, -1) : inner).trim();
    const nameMatch = body.match(/^([^\s\/]+)/);
    if (!nameMatch) continue;
    const tagName = nameMatch[1];
    const attrs = parseAttrs(body.slice(nameMatch[0].length));
    const node = makeNode(tagName, attrs, current);
    current.children.push({ type: 'element', node });
    sawAnyElement = true;
    if (!selfClosing) {
      stack.push(node);
      current = node;
    }
  }

  if (stack.length > 1) {
    errors.push('Nasledovné tagy neboli zatvorené: ' + stack.slice(1).map((n) => n.rawTag).join(', '));
  }
  if (!sawAnyElement) {
    errors.push('V súbore sa nenašiel žiadny XML element.');
  }

  return { root, malformed: errors.length > 0, errors };
}

// ── tree query helpers (operate on the {tag, attrs, children} node shape) ──

function elementChildren(node) {
  if (!node) return [];
  return node.children.filter((c) => c.type === 'element').map((c) => c.node);
}

function firstChild(node, tag) {
  if (!node) return null;
  const found = node.children.find((c) => c.type === 'element' && c.node.tag === tag);
  return found ? found.node : null;
}

function allChildren(node, tag) {
  if (!node) return [];
  return node.children.filter((c) => c.type === 'element' && c.node.tag === tag).map((c) => c.node);
}

function findAll(node, tag, out) {
  out = out || [];
  if (!node) return out;
  for (const c of node.children) {
    if (c.type === 'element') {
      if (c.node.tag === tag) out.push(c.node);
      findAll(c.node, tag, out);
    }
  }
  return out;
}

function textOf(node) {
  if (!node) return '';
  let out = '';
  for (const c of node.children) {
    if (c.type === 'text') out += c.text;
  }
  return out.trim();
}

function path(node, tag) {
  return node ? firstChild(node, tag) : null;
}

// ───────────────────────────── IBAN helpers ────────────────────────────────

const IBAN_LENGTH_BY_COUNTRY = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18,
  EE: 20, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GI: 23, GL: 18, GR: 27,
  HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21,
  MC: 27, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19,
  SK: 24, SM: 27, VA: 22,
};

// Countries in the SEPA scheme geographical scope (EU/EEA + a handful of
// participating non-EU countries) per the EPC SEPA scheme rulebooks.
const SEPA_COUNTRIES = new Set([
  'AD', 'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE',
  'GI', 'GR', 'HU', 'IS', 'IE', 'IT', 'LV', 'LI', 'LT', 'LU', 'MT', 'MC',
  'NL', 'NO', 'PL', 'PT', 'RO', 'SM', 'SK', 'SI', 'ES', 'SE', 'CH', 'GB',
  'VA',
]);

function normalizeIban(raw) {
  return safeStr(raw).replace(/\s+/g, '').toUpperCase();
}

function ibanMod97(numericStr) {
  let rem = 0;
  for (let k = 0; k < numericStr.length; k++) {
    rem = (rem * 10 + (numericStr.charCodeAt(k) - 48)) % 97;
  }
  return rem;
}

function ibanNumericString(iban) {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let out = '';
  for (const ch of rearranged) {
    if (ch >= '0' && ch <= '9') out += ch;
    else out += String(ch.charCodeAt(0) - 55); // A=10 .. Z=35
  }
  return out;
}

function checkIban(rawIban) {
  const iban = normalizeIban(rawIban);
  const result = { raw: rawIban, value: iban, present: iban.length > 0, formatOk: false, checksumOk: false, country: '', lengthOk: false, isSepaCountry: false };
  if (!iban) return result;
  const m = iban.match(/^([A-Z]{2})(\d{2})([A-Z0-9]+)$/);
  if (!m) return result;
  result.country = m[1];
  result.formatOk = true;
  result.isSepaCountry = SEPA_COUNTRIES.has(result.country);
  const expectedLen = IBAN_LENGTH_BY_COUNTRY[result.country];
  result.lengthOk = expectedLen ? iban.length === expectedLen : iban.length >= 15 && iban.length <= 34;
  try {
    result.checksumOk = ibanMod97(ibanNumericString(iban)) === 1;
  } catch (e) {
    result.checksumOk = false;
  }
  return result;
}

// Slovak domestic BBAN check ("posledných 10 miest čísla IBAN musí
// vyhovovať algoritmu modulo11": Tatra banka spec, section 2.80): the last
// 10 digits of the IBAN (the "základné číslo účtu") weighted from the left
// by [6,3,7,9,10,5,8,4,2,1] must sum to a multiple of 11.
const SK_MOD11_WEIGHTS = [6, 3, 7, 9, 10, 5, 8, 4, 2, 1];

function skModulo11Ok(iban) {
  const last10 = iban.slice(-10);
  if (!/^\d{10}$/.test(last10)) return null; // not applicable / can't check
  let sum = 0;
  for (let k = 0; k < 10; k++) sum += (last10.charCodeAt(k) - 48) * SK_MOD11_WEIGHTS[k];
  return sum % 11 === 0;
}

// ─────────────────────────────── BIC helpers ───────────────────────────────

const BIC_RE = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

function bicFormatOk(bic) {
  return BIC_RE.test(safeStr(bic).toUpperCase());
}

// Four-digit Slovak domestic bank codes → BIC, for the four banks this tool
// targets (embedded in every Slovak IBAN's BBAN as the first 4 digits).
const SK_BANK_CODE_TO_BIC = {
  '1100': 'TATRSKBX',
  '0900': 'GIBASKBX',
  '0200': 'SUBASKBX',
  '7500': 'CEKOSKBX',
};

const BANKS = {
  tatrabanka: { label: 'Tatra banka', bic: 'TATRSKBX', execWindowDays: 31, cdtrBicPolicy: 'derivable' },
  slsp: { label: 'Slovenská sporiteľňa', bic: 'GIBASKBX', execWindowDays: null, cdtrBicPolicy: 'unspecified' },
  vub: { label: 'VÚB', bic: 'SUBASKBX', execWindowDays: 30, cdtrBicPolicy: 'mandatory' },
  csob: { label: 'ČSOB', bic: 'CEKOSKBX', execWindowDays: null, cdtrBicPolicy: 'optional' },
  generic: { label: 'iná / neuvedená banka', bic: null, execWindowDays: null, cdtrBicPolicy: 'unspecified' },
};

function bankInfo(bankKey) {
  return BANKS[bankKey] || BANKS.generic;
}

// ─────────────────────── SEPA character set / diacritics ──────────────────
// ČSOB's own document spells out the allowed set exactly (see file header);
// used here as the general SEPA-safe character set for every bank, per the
// same convention EPC's implementation guidelines describe informally.

const SEPA_CHARSET_RE = /^[A-Za-z0-9 \/\-–?:().,'+]*$/;

const DIACRITIC_MAP = {
  á: 'a', ä: 'a', č: 'c', ď: 'd', é: 'e', í: 'i', ľ: 'l', ĺ: 'l', ň: 'n',
  ó: 'o', ô: 'o', ŕ: 'r', š: 's', ť: 't', ú: 'u', ý: 'y', ž: 'z',
  ě: 'e', ř: 'r', ů: 'u',
  Á: 'A', Ä: 'A', Č: 'C', Ď: 'D', É: 'E', Í: 'I', Ľ: 'L', Ĺ: 'L', Ň: 'N',
  Ó: 'O', Ô: 'O', Ŕ: 'R', Š: 'S', Ť: 'T', Ú: 'U', Ý: 'Y', Ž: 'Z',
  Ě: 'E', Ř: 'R', Ů: 'U',
};

function hasDiacritics(str) {
  for (const ch of str) if (Object.prototype.hasOwnProperty.call(DIACRITIC_MAP, ch)) return true;
  return false;
}

function transliterate(str) {
  let out = '';
  for (const ch of str) out += Object.prototype.hasOwnProperty.call(DIACRITIC_MAP, ch) ? DIACRITIC_MAP[ch] : ch;
  return out;
}

function otherInvalidChars(str) {
  const bad = new Set();
  for (const ch of str) {
    if (!SEPA_CHARSET_RE.test(ch) && !Object.prototype.hasOwnProperty.call(DIACRITIC_MAP, ch)) bad.add(ch);
  }
  return Array.from(bad);
}

// ────────────────────────────── date helpers ───────────────────────────────

function parseIsoDate(str) {
  const s = safeStr(str).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0)));
  if (Number.isNaN(d.getTime())) return null;
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null; // e.g. 2024-02-30
  return d;
}

function daysBetweenUtcDates(a, b) {
  const MS = 24 * 60 * 60 * 1000;
  const da = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const db = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((db - da) / MS);
}

// ─────────────────────────── VS/ŠS/KS reference symbols ───────────────────
// National Bank of Slovakia convention, packed into EndToEndId in the exact
// order /VS.../SS.../KS... (ČSOB's guide, see file header, with worked
// examples of the wrong order breaking counterparty reconciliation).

function analyzeReferenceSymbols(endToEndId) {
  const s = safeStr(endToEndId);
  const re = /\/(VS|SS|KS)(\d*)/gi;
  const found = [];
  let m;
  while ((m = re.exec(s))) found.push({ kind: m[1].toUpperCase(), value: m[2], index: m.index });
  if (found.length === 0) return null;

  const order = found.map((f) => f.kind);
  const rank = { VS: 0, SS: 1, KS: 2 };
  let orderOk = true;
  for (let k = 1; k < order.length; k++) {
    if (rank[order[k]] < rank[order[k - 1]]) orderOk = false;
  }
  const maxLen = { VS: 10, SS: 10, KS: 4 };
  const lengthIssues = found.filter((f) => f.value.length > maxLen[f.kind]);
  const nonNumeric = /\/(VS|SS|KS)([^\/]*)/gi;
  let m2;
  const nonNumericIssues = [];
  while ((m2 = nonNumeric.exec(s))) {
    if (m2[2] && !/^\d*$/.test(m2[2])) nonNumericIssues.push({ kind: m2[1].toUpperCase(), value: m2[2] });
  }

  const by = {};
  for (const f of found) by[f.kind] = f.value;
  const canonical = '/VS' + (by.VS || '') + '/SS' + (by.SS || '') + '/KS' + (by.KS || '');

  return { found, order, orderOk, lengthIssues, nonNumericIssues, canonical };
}

// ────────────────────────────── amount helpers ─────────────────────────────

function parseAmountText(str) {
  const s = safeStr(str).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

// ──────────────────────────────── main logic ───────────────────────────────

// ── Štruktúrovaná adresa: termín 15. novembra 2026 ──────────────────────────
//
// Od 15. 11. 2026 sa v SEPA schémach (SCT, SCT Inst, SDD Core aj B2B) prestáva
// prijímať plne neštruktúrovaná poštová adresa. Ak je adresa v správe uvedená,
// musí byť štruktúrovaná alebo hybridná, a v oboch prípadoch musí obsahovať
// aspoň mesto (TwnNm) a kód krajiny (Ctry). Banka súbor so starou adresou
// odmietne.
//
// Pozor na rozšírený omyl: pain.001.001.03 štruktúrovanú adresu unesie. Jej
// PostalAddress6 má StrtNm, BldgNb, PstCd, TwnNm, CtrySubDvsn aj Ctry, takže
// požiadavku "aspoň mesto a krajina" splníte aj v nej. Novšia PostalAddress24
// z pain.001.001.09 pridáva len jemnejšie polia (BldgNm, Flr, PstBx, Room,
// TwnLctnNm, DstrctNm) a obmedzuje AdrLine na dva riadky. Prechod na .09 teda
// nevynucuje adresa, ale to, že časť bánk k termínu prestáva .03 prijímať.
//
// Pozor na dátum. Verzia 1.0 pravidiel SEPA úhrady z roku 2025 uvádzala ako
// koniec neštruktúrovanej adresy 22. november 2026; verzia 1.1 to opravila na
// 15. november 2026, a to je platný dátum. Časť bankových stránok stále cituje
// staršiu verziu, preto sa tie dva dátumy na internete miešajú. Samé pravidlá
// z roku 2025 (a s nimi hybridná adresa) platia od 5. októbra 2025.
//
// Zdroje overené 6. 9. 2026:
//  - European Payments Council, zosúladenie schém SCT/SCT Inst/SDD na 15. 11. 2026
//    https://www.europeanpaymentscouncil.eu/
//  - ECB / Payments Market Practice Group, vzorový list korporátnym klientom
//    o prechode na hybridnú adresu (2025-10-22)
//    https://www.ecb.europa.eu/paym/groups/shared/docs/daba2-industry-template-hybrid-address-communication-to-corporates-pmpg-2025-10-22-.pdf
//  - BNP Paribas, "Structured address in payments: the new rules in force from November 2026" (07/2026)
//  - Komerční banka, "Nová pravidla pro vyplňování strukturované adresy u SEPA
//    a zahraničních plateb" (pain.001.001.03 sa od 15. 11. 2026 prestane používať)
//    https://www.kb.cz/cs/podpora/ucty-a-platby/nova-pravidla-pro-vyplnovani-strukturovane-adresy-u-sepa-a-zahranicnich-plateb-multicash
//
// Kontrola je zámerne opatrná: hlási len to, čo v súbore naozaj je. Súbor bez
// adries neoznačuje za chybný, lebo adresa je v SEPA nepovinná a súbor bez nej
// prejde aj po termíne.
export const TERMIN_ADRESY = '2026-11-15';

/** Cesta k prvku, napr. "Document/CstmrCdtTrfInitn/PmtInf/Cdtr/PstlAdr".
 *  Pozor: funkcia path() vyssie je v skutocnosti firstChild, nie cesta. */
function cestaK(node) {
  const kusy = [];
  for (let n = node; n && n.tag; n = n.parent) kusy.unshift(n.tag);
  return kusy.filter((k) => k !== '#root').join('/');
}

/**
 * Kód banky z <FinInstnId>. V pain.001.001.03 sa prvok volá <BIC>
 * (FinancialInstitutionIdentification8), v .09 <BICFI>
 * (FinancialInstitutionIdentification18). Je to ten istý údaj, len iný
 * názov, tak vraciame aj hodnotu, aj názov, aby sme v hlásení menovali
 * prvok, ktorý v súbore naozaj je.
 */
function bicZFinInstnId(finInstnId) {
  if (!finInstnId) return { hodnota: '', znacka: 'BIC' };
  const stary = firstChild(finInstnId, 'BIC');
  if (stary) return { hodnota: textOf(stary), znacka: 'BIC' };
  const novy = firstChild(finInstnId, 'BICFI');
  if (novy) return { hodnota: textOf(novy), znacka: 'BICFI' };
  return { hodnota: '', znacka: 'BIC' };
}

/** Ktora strana platby to je, podla predkov prvku. */
// Vracia kľúč, nie hotové slovo: pomenovanie strany sa prekladá v SPRAVY,
// lebo v nemčine má iný pád než v slovenčine.
function ktoraStrana(node) {
  for (let n = node; n && n.tag; n = n.parent) {
    if (n.tag === 'Cdtr') return 'Cdtr';
    if (n.tag === 'Dbtr') return 'Dbtr';
    if (n.tag === 'UltmtCdtr') return 'UltmtCdtr';
    if (n.tag === 'UltmtDbtr') return 'UltmtDbtr';
    if (n.tag === 'InitgPty') return 'InitgPty';
  }
  return '_';
}

/** Rozoberie jeden <PstlAdr> na to, čo v ňom je. */
function rozborAdresy(pstlAdr) {
  const polia = {};
  for (const ch of elementChildren(pstlAdr)) polia[ch.tag] = (polia[ch.tag] || []).concat(textOf(ch).trim());
  const adrLine = (polia.AdrLine || []).filter(Boolean);
  const struktura = ['Dept', 'SubDept', 'StrtNm', 'BldgNb', 'BldgNm', 'Flr', 'PstBx', 'Room', 'PstCd', 'TwnNm', 'TwnLctnNm', 'DstrctNm', 'CtrySubDvsn', 'Ctry']
    .filter((k) => (polia[k] || []).some(Boolean));
  const mesto = (polia.TwnNm || [])[0] || '';
  const krajina = (polia.Ctry || [])[0] || '';
  return { adrLine, struktura, mesto, krajina, prazdna: adrLine.length === 0 && struktura.length === 0 };
}

/**
 * @param {object} documentEl koreň <Document>
 * @param {function} addProblem
 * @param {string} dnes ISO dátum, kvôli testovateľnosti; po termíne sa mení
 *   závažnosť z "stredná" (ešte je čas) na "vysoká" (banka to už odmieta)
 */
function skontrolujAdresy(documentEl, addProblem, dnes, T) {
  const vsetky = [];
  findAll(documentEl, 'PstlAdr', vsetky);
  if (!vsetky.length) return { spolu: 0, zle: 0 };

  const poTermine = String(dnes || '') >= TERMIN_ADRESY;
  const zavaznost = poTermine ? 'high' : 'medium';
  let zle = 0;
  const uzHlasene = new Set();

  for (const adr of vsetky) {
    const a = rozborAdresy(adr);
    if (a.prazdna) continue;
    const kde = cestaK(adr);
    const cieCast = T.strana[ktoraStrana(adr)] || T.strana._;

    if (a.adrLine.length && !a.struktura.length) {
      zle++;
      if (uzHlasene.has('cela_nestruktura')) continue;
      uzHlasene.add('cela_nestruktura');
      addProblem({
        code: 'adresa_nestrukturovana',
        severity: zavaznost,
        message: T.adresaNestrukturovana(cieCast, poTermine),
        path: kde,
        value: a.adrLine.join(' | '),
        fix: '<PstlAdr><TwnNm>Bratislava</TwnNm><Ctry>SK</Ctry></PstlAdr>',
      });
      continue;
    }

    if (!a.mesto || !a.krajina) {
      zle++;
      const chyba = !a.mesto && !a.krajina ? T.chybaMestoKrajina : !a.mesto ? T.chybaMesto : T.chybaKrajina;
      if (uzHlasene.has('chyba_' + chyba)) continue;
      uzHlasene.add('chyba_' + chyba);
      addProblem({
        code: 'adresa_bez_mesta_alebo_krajiny',
        severity: zavaznost,
        message: T.adresaBezMestaKrajiny(cieCast, chyba),
        path: kde,
        value: a.struktura.join(', '),
        fix: !a.mesto ? '<TwnNm>Bratislava</TwnNm>' : '<Ctry>SK</Ctry>',
      });
      continue;
    }

    if (a.adrLine.length > 2) {
      zle++;
      if (uzHlasene.has('vela_riadkov')) continue;
      uzHlasene.add('vela_riadkov');
      addProblem({
        code: 'adresa_prilis_vela_riadkov',
        severity: 'low',
        message: T.adresaVelaRiadkov(a.adrLine.length),
        path: kde,
        value: a.adrLine.join(' | '),
        fix: '<StrtNm>Ivanská cesta</StrtNm><BldgNb>32E</BldgNb>',
      });
    }

    if (a.krajina && !/^[A-Z]{2}$/.test(a.krajina)) {
      zle++;
      addProblem({
        code: 'adresa_zly_kod_krajiny',
        severity: 'high',
        message: T.adresaZlyKodKrajiny(a.krajina),
        path: kde + '/Ctry',
        value: a.krajina,
        fix: '<Ctry>SK</Ctry>',
      });
    }
  }
  return { spolu: vsetky.length, zle: zle };
}

const PAIN_NAMESPACE = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.03';
const PAIN_NAMESPACE_09 = 'urn:iso:std:iso:20022:tech:xsd:pain.001.001.09';
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

function sortProblems(problems) {
  return problems
    .map((p, idx) => ({ p, idx }))
    .sort((a, b) => (SEVERITY_ORDER[a.p.severity] - SEVERITY_ORDER[b.p.severity]) || (a.idx - b.idx))
    .map((x) => x.p);
}

function fmtAmount(n) {
  return n.toFixed(2);
}

/**
 * @param {{xml?: string, bank?: 'tatrabanka'|'slsp'|'vub'|'csob'|'generic', expectedTxCount?: number|null, lang?: 'sk'|'en'|'de'}} input
 * @returns {{status:'pass'|'warn'|'fail', summary:string, bank:string, expected:object, stats:object, problems:Array, fixes:Array, checklist:string[], disclaimer:string}}
 */
export function diagnose(input) {
  const cfg = input && typeof input === 'object' ? input : {};
  const xmlText = safeStr(cfg.xml);
  const bankKey = ['tatrabanka', 'slsp', 'vub', 'csob', 'generic'].includes(cfg.bank) ? cfg.bank : 'generic';
  const bank = bankInfo(bankKey);
  const expectedTxCount = isNum(cfg.expectedTxCount) ? cfg.expectedTxCount : null;
  // Dátum sa vyhodnocuje raz na začiatku: rozhoduje o očakávanej verzii
  // správy aj o závažnosti adresných nálezov (pozri TERMIN_ADRESY).
  const dnes = cfg.dnes || new Date().toISOString().slice(0, 10);
  const poTermine = String(dnes) >= TERMIN_ADRESY;
  // Jazyk hlášok. Predvolene slovenčina, aby sa existujúce volania nezmenili.
  const T = slovnikPre(cfg.lang);

  const problems = [];
  const checklist = [];

  function addProblem(p) {
    problems.push({ code: p.code, severity: p.severity, message: p.message, path: p.path || '', value: p.value === undefined ? '' : String(p.value), fix: p.fix === undefined ? '' : String(p.fix) });
  }

  const expected = {
    bank: bankKey,
    bankLabel: bank.label,
    bankBic: bank.bic,
    schemaNamespace: poTermine ? PAIN_NAMESPACE_09 : PAIN_NAMESPACE,
    execWindowDays: bank.execWindowDays,
    nbOfTxsShouldBe: null,
    ctrlSumShouldBe: null,
  };
  const stats = { txCount: 0, pmtInfCount: 0, sum: '0.00', currencies: [], banksDetected: [] };

  if (!xmlText.trim()) {
    addProblem({
      code: 'xml_empty',
      severity: 'high',
      message: T.xmlPrazdne,
      path: '',
    });
    return finish();
  }

  const parsed = parseXml(xmlText);
  if (parsed.malformed) {
    addProblem({
      code: 'xml_not_well_formed',
      severity: 'high',
      message: T.xmlZleFormovane(parsed.errors[0], parsed.errors.length > 1 ? parsed.errors.length - 1 : 0),
      path: '',
    });
  }

  const documentEl = elementChildren(parsed.root).find((n) => n.tag === 'Document');
  if (!documentEl) {
    addProblem({
      code: 'root_missing',
      severity: 'high',
      message: T.chybaDocument,
      path: '',
    });
    return finish();
  }

  const ns = documentEl.attrs.xmlns || '';
  if (!ns) {
    addProblem({
      code: 'schema_namespace_missing',
      severity: 'medium',
      message: T.chybaXmlns(PAIN_NAMESPACE),
      path: 'Document',
      fix: `xmlns="${PAIN_NAMESPACE}"`,
    });
  } else if (ns === PAIN_NAMESPACE_09) {
    // pain.001.001.09 je platná verzia správy, nie chyba. Do 15. 11. 2026 ju
    // však slovenské banky pri hromadnom importe zväčša ešte nečakajú, preto
    // je to poznámka, nie problém, a po termíne mizne úplne.
    if (!poTermine) {
      addProblem({
        code: 'schema_namespace_09_skoro',
        severity: 'low',
        message: T.verzia09Skoro,
        path: 'Document',
        value: ns,
      });
    }
  } else if (ns !== PAIN_NAMESPACE) {
    const looksNewer = /pain\.001\.001\.0[4-9]|pain\.001\.001\.1\d/.test(ns);
    addProblem({
      code: 'schema_namespace_unexpected',
      severity: 'medium',
      message: T.neznamyNs(ns, looksNewer),
      path: 'Document',
      value: ns,
      fix: `xmlns="${poTermine ? PAIN_NAMESPACE_09 : PAIN_NAMESPACE}"`,
    });
  } else if (poTermine) {
    // ns === .03 po termíne. Zámerne stredná závažnosť, nie vysoká: termín
    // 15. 11. 2026 zo schém SEPA hovorí o adrese, nie o verzii správy medzi
    // klientom a bankou. Verziu si určuje každá banka sama. Komerční banka
    // zverejnila, že .03 prestane prijímať; pre všetky štyri slovenské banky
    // to overené nemáme, preto to hlásime ako "over si to", nie ako istotu.
    addProblem({
      code: 'schema_namespace_03_po_termine',
      severity: 'medium',
      message: T.verzia03PoTermine,
      path: 'Document',
      value: ns,
      fix: `xmlns="${PAIN_NAMESPACE_09}"`,
    });
  }

  const cstmr = firstChild(documentEl, 'CstmrCdtTrfInitn');
  if (!cstmr) {
    addProblem({
      code: 'root_missing',
      severity: 'high',
      message: T.chybaCstmr,
      path: 'Document',
    });
    return finish();
  }

  // ── GrpHdr ──────────────────────────────────────────────────────────────
  const grpHdr = firstChild(cstmr, 'GrpHdr');
  const pmtInfList = allChildren(cstmr, 'PmtInf');
  const allTx = findAll(cstmr, 'CdtTrfTxInf');
  const actualTxCount = allTx.length;
  const actualSum = allTx.reduce((sum, tx) => {
    const amtEl = path(path(tx, 'Amt'), 'InstdAmt');
    const n = amtEl ? parseAmountText(textOf(amtEl)) : null;
    return sum + (n || 0);
  }, 0);

  expected.nbOfTxsShouldBe = actualTxCount;
  expected.ctrlSumShouldBe = fmtAmount(actualSum);
  stats.txCount = actualTxCount;
  stats.pmtInfCount = pmtInfList.length;
  stats.sum = fmtAmount(actualSum);

  if (pmtInfList.length === 0) {
    addProblem({ code: 'pmt_inf_missing', severity: 'high', message: T.chybaPmtInf, path: 'CstmrCdtTrfInitn' });
  }
  if (actualTxCount === 0 && pmtInfList.length > 0) {
    addProblem({ code: 'cdt_trf_tx_inf_missing', severity: 'high', message: T.chybaTx, path: 'CstmrCdtTrfInitn/PmtInf' });
  }

  if (grpHdr) {
    const msgIdEl = firstChild(grpHdr, 'MsgId');
    if (msgIdEl) {
      const msgId = textOf(msgIdEl);
      if (msgId.length > 35) {
        addProblem({ code: 'msg_id_too_long', severity: 'medium', message: T.msgIdDlhy(msgId.length), path: 'CstmrCdtTrfInitn/GrpHdr/MsgId', value: msgId, fix: msgId.slice(0, 35) });
      }
      if (msgId && !SEPA_CHARSET_RE.test(msgId)) {
        addProblem({ code: 'invalid_sepa_character', severity: 'low', message: T.msgIdZnaky, path: 'CstmrCdtTrfInitn/GrpHdr/MsgId', value: msgId, fix: transliterate(msgId) });
      }
    } else {
      checklist.push(T.chkMsgId);
    }

    const creDtTmEl = firstChild(grpHdr, 'CreDtTm');
    if (creDtTmEl) {
      const creDtTm = textOf(creDtTmEl);
      if (!parseIsoDate(creDtTm)) {
        addProblem({ code: 'cre_dt_tm_invalid_format', severity: 'medium', message: T.creDtTmZly(creDtTm), path: 'CstmrCdtTrfInitn/GrpHdr/CreDtTm', value: creDtTm });
      }
    }

    const nbOfTxsEl = firstChild(grpHdr, 'NbOfTxs');
    if (nbOfTxsEl) {
      const declared = Number(textOf(nbOfTxsEl));
      if (!Number.isFinite(declared) || declared !== actualTxCount) {
        addProblem({
          code: 'nb_of_txs_mismatch',
          severity: 'high',
          message: T.nbOfTxsNesedi(textOf(nbOfTxsEl) || T.prazdne, actualTxCount),
          path: 'CstmrCdtTrfInitn/GrpHdr/NbOfTxs',
          value: textOf(nbOfTxsEl),
          fix: String(actualTxCount),
        });
      }
    } else {
      checklist.push(T.chkNbOfTxs(actualTxCount));
    }

    const ctrlSumEl = firstChild(grpHdr, 'CtrlSum');
    if (ctrlSumEl) {
      const declared = parseAmountText(textOf(ctrlSumEl));
      if (declared === null || Math.abs(declared - actualSum) > 0.005) {
        addProblem({
          code: 'ctrl_sum_mismatch',
          severity: 'high',
          message: T.ctrlSumNesedi(textOf(ctrlSumEl) || T.prazdne, fmtAmount(actualSum)),
          path: 'CstmrCdtTrfInitn/GrpHdr/CtrlSum',
          value: textOf(ctrlSumEl),
          fix: fmtAmount(actualSum),
        });
      }
    } else {
      checklist.push(T.chkCtrlSum(fmtAmount(actualSum)));
    }

    const initgPty = firstChild(grpHdr, 'InitgPty');
    if (initgPty) {
      const nmEl = firstChild(initgPty, 'Nm');
      if (nmEl) {
        const nm = textOf(nmEl);
        if (bankKey === 'tatrabanka' && nm && !/^[A-Za-z0-9]{1,10}\/[A-Z]{2}$/.test(nm)) {
          addProblem({
            code: 'initg_pty_name_pattern',
            severity: 'low',
            message: T.initgPtyVzor(nm),
            path: 'CstmrCdtTrfInitn/GrpHdr/InitgPty/Nm',
            value: nm,
          });
        }
        if (hasDiacritics(nm) || otherInvalidChars(nm).length) {
          reportCharset(nm, 'CstmrCdtTrfInitn/GrpHdr/InitgPty/Nm');
        }
      }
    }
  }

  // ── character-set scan helper (used across Dbtr/Cdtr/RmtInf/AdrLine) ───
  function reportCharset(value, elPath) {
    if (!value) return;
    if (hasDiacritics(value)) {
      addProblem({
        code: 'diacritics_in_field',
        severity: bankKey === 'csob' ? 'high' : 'medium',
        message: bankKey === 'csob' ? T.diakritikaCsob(value) : T.diakritikaVseobecne(value),
        path: elPath,
        value,
        fix: transliterate(value),
      });
    }
    const other = otherInvalidChars(value);
    if (other.length) {
      addProblem({
        code: 'invalid_sepa_character',
        severity: bankKey === 'csob' ? 'high' : 'medium',
        message: T.mimoSady(value, other.map((c) => `"${c}"`).join(', ')),
        path: elPath,
        value,
      });
    }
  }

  // ── walk each PmtInf block ───────────────────────────────────────────────
  let prevExecDate = null;

  pmtInfList.forEach((pmtInf, pmtIdx) => {
    const pmtPath = `CstmrCdtTrfInitn/PmtInf[${pmtIdx + 1}]`;
    const txList = allChildren(pmtInf, 'CdtTrfTxInf');

    if (bankKey === 'tatrabanka' && txList.length > 500) {
      addProblem({ code: 'pmt_inf_tx_count_exceeded', severity: 'high', message: T.pmtInfLimit(pmtIdx + 1, txList.length), path: pmtPath, value: String(txList.length) });
    } else if (bankKey !== 'tatrabanka' && txList.length > 500) {
      addProblem({ code: 'pmt_inf_tx_count_exceeded_generic', severity: 'low', message: T.pmtInfLimitInde(pmtIdx + 1, txList.length), path: pmtPath, value: String(txList.length) });
    }

    const pmtMtdEl = firstChild(pmtInf, 'PmtMtd');
    const pmtMtd = pmtMtdEl ? textOf(pmtMtdEl) : '';
    if (pmtMtd !== 'TRF') {
      addProblem({ code: 'pmt_mtd_invalid', severity: 'high', message: T.pmtMtdZly(pmtIdx + 1, pmtMtd || T.chybaHodnota), path: `${pmtPath}/PmtMtd`, value: pmtMtd, fix: 'TRF' });
    }

    // PmtInf-level PmtTpInf/ChrgBr take precedence over the per-transaction
    // ones (VÚB spec: "Vyplnený môže byť element 2.6 ... alebo element 2.31
    // ... nie oba súčasne" / "hodnoty na úrovni Transaction information
    // nebudú spracované" when the PmtInf-level ones are present).
    const pmtTpInf = firstChild(pmtInf, 'PmtTpInf');
    const pmtInfInstrPrty = pmtTpInf ? textOf(firstChild(pmtTpInf, 'InstrPrty')) : '';
    const pmtInfSvcLvl = pmtTpInf ? textOf(path(pmtTpInf, 'SvcLvl') && firstChild(path(pmtTpInf, 'SvcLvl'), 'Cd')) : '';
    const pmtInfChrgBr = textOf(firstChild(pmtInf, 'ChrgBr'));

    // V pain.001.001.03 je dátum priamo v <ReqdExctnDt>. V .09 je ten prvok
    // typu DateAndDateTime2Choice, takže dátum je zabalený v <Dt> (alebo
    // presný čas v <DtTm>). Bez tejto vetvy by sme každý súbor vo verzii .09
    // označili za súbor s nečitateľným dátumom splatnosti.
    const reqdExctnDtEl = firstChild(pmtInf, 'ReqdExctnDt');
    const reqdExctnDtDt = reqdExctnDtEl && (firstChild(reqdExctnDtEl, 'Dt') || firstChild(reqdExctnDtEl, 'DtTm'));
    const reqdExctnDtRaw = reqdExctnDtDt ? textOf(reqdExctnDtDt).slice(0, 10)
      : (reqdExctnDtEl ? textOf(reqdExctnDtEl) : '');
    if (!reqdExctnDtEl || !reqdExctnDtRaw) {
      addProblem({ code: 'exec_date_missing', severity: 'high', message: T.datumChyba(pmtIdx + 1), path: `${pmtPath}/ReqdExctnDt` });
    } else {
      const d = parseIsoDate(reqdExctnDtRaw);
      if (!d) {
        addProblem({ code: 'exec_date_invalid_format', severity: 'high', message: T.datumFormat(pmtIdx + 1, reqdExctnDtRaw), path: `${pmtPath}/ReqdExctnDt`, value: reqdExctnDtRaw });
      } else {
        // Porovnáva sa s cfg.dnes, nie s hodinami: rovnaký súbor musí dať
        // rovnaký výsledok aj v teste, aj o mesiac.
        const now = parseIsoDate(dnes) || new Date();
        const diffDays = daysBetweenUtcDates(now, d);
        if (diffDays < 0) {
          addProblem({ code: 'exec_date_in_past', severity: 'medium', message: T.datumMinulost(pmtIdx + 1, reqdExctnDtRaw), path: `${pmtPath}/ReqdExctnDt`, value: reqdExctnDtRaw });
        } else if (bank.execWindowDays != null && diffDays > bank.execWindowDays) {
          addProblem({ code: 'exec_date_too_far_future', severity: 'high', message: T.datumDaleko(pmtIdx + 1, reqdExctnDtRaw, diffDays, bank.label, bank.execWindowDays), path: `${pmtPath}/ReqdExctnDt`, value: reqdExctnDtRaw });
        } else if (bank.execWindowDays == null && diffDays > 31) {
          addProblem({ code: 'exec_date_too_far_future', severity: 'low', message: T.datumDalekoInde(pmtIdx + 1, reqdExctnDtRaw, diffDays), path: `${pmtPath}/ReqdExctnDt`, value: reqdExctnDtRaw });
        }
        if (bankKey === 'tatrabanka') {
          if (prevExecDate && prevExecDate !== reqdExctnDtRaw) {
            addProblem({ code: 'exec_date_differs_across_pmtinf', severity: 'medium', message: T.datumRozdielny(pmtIdx + 1, reqdExctnDtRaw, prevExecDate), path: `${pmtPath}/ReqdExctnDt`, value: reqdExctnDtRaw });
          }
          prevExecDate = reqdExctnDtRaw;
        }
      }
    }

    const dbtr = firstChild(pmtInf, 'Dbtr');
    const dbtrNmEl = dbtr ? firstChild(dbtr, 'Nm') : null;
    const dbtrNm = dbtrNmEl ? textOf(dbtrNmEl) : '';
    if (!dbtrNm) {
      addProblem({ code: 'dbtr_name_missing', severity: 'high', message: T.dbtrNmChyba(pmtIdx + 1), path: `${pmtPath}/Dbtr/Nm` });
    } else {
      if (dbtrNm.length > 70) addProblem({ code: 'dbtr_name_too_long', severity: 'high', message: T.dbtrNmDlhy(pmtIdx + 1, dbtrNm.length), path: `${pmtPath}/Dbtr/Nm`, value: dbtrNm, fix: dbtrNm.slice(0, 70) });
      reportCharset(dbtrNm, `${pmtPath}/Dbtr/Nm`);
    }

    const dbtrAcctIban = textOf(path(path(pmtInf, 'DbtrAcct'), 'Id') && firstChild(path(path(pmtInf, 'DbtrAcct'), 'Id'), 'IBAN'));
    if (!dbtrAcctIban) {
      addProblem({ code: 'dbtr_iban_missing', severity: 'high', message: T.dbtrIbanChyba(pmtIdx + 1), path: `${pmtPath}/DbtrAcct/Id/IBAN` });
    } else {
      const ibanCheck = checkIban(dbtrAcctIban);
      if (!ibanCheck.formatOk || !ibanCheck.lengthOk || !ibanCheck.checksumOk) {
        addProblem({ code: 'dbtr_iban_invalid', severity: 'high', message: T.dbtrIbanZly(pmtIdx + 1, dbtrAcctIban, !ibanCheck.formatOk ? T.ibanFormat : !ibanCheck.lengthOk ? T.ibanDlzka(ibanCheck.country) : T.ibanSucet), path: `${pmtPath}/DbtrAcct/Id/IBAN`, value: dbtrAcctIban });
      } else if (dbtrAcctIban.replace(/\s+/g, '') !== dbtrAcctIban) {
        addProblem({ code: 'dbtr_iban_has_spaces', severity: 'low', message: T.dbtrIbanMedzery(pmtIdx + 1), path: `${pmtPath}/DbtrAcct/Id/IBAN`, value: dbtrAcctIban, fix: normalizeIban(dbtrAcctIban) });
      }
      recordDetectedBank(ibanCheck.value);
    }

    const dbtrAgtBicPole = bicZFinInstnId(path(path(pmtInf, 'DbtrAgt'), 'FinInstnId'));
    const dbtrAgtBic = dbtrAgtBicPole.hodnota;
    const dbtrBicTag = dbtrAgtBicPole.znacka;
    if (!dbtrAgtBic) {
      addProblem({ code: 'dbtr_bic_missing', severity: 'medium', message: T.dbtrBicChyba(pmtIdx + 1, dbtrBicTag, bank.label, bank.bic), path: `${pmtPath}/DbtrAgt/FinInstnId/${dbtrBicTag}`, fix: bank.bic || undefined });
    } else if (bank.bic && dbtrAgtBic.toUpperCase() !== bank.bic) {
      addProblem({ code: 'dbtr_bic_mismatch', severity: 'high', message: T.dbtrBicNesedi(pmtIdx + 1, dbtrBicTag, dbtrAgtBic, bank.label, bank.bic), path: `${pmtPath}/DbtrAgt/FinInstnId/${dbtrBicTag}`, value: dbtrAgtBic, fix: bank.bic });
    } else if (!bicFormatOk(dbtrAgtBic)) {
      addProblem({ code: 'dbtr_bic_format_invalid', severity: 'medium', message: T.dbtrBicFormat(pmtIdx + 1, dbtrBicTag, dbtrAgtBic), path: `${pmtPath}/DbtrAgt/FinInstnId/${dbtrBicTag}`, value: dbtrAgtBic });
    }

    if (txList.length === 0) {
      addProblem({ code: 'cdt_trf_tx_inf_missing', severity: 'high', message: T.pmtInfBezTx(pmtIdx + 1), path: `${pmtPath}` });
    }

    const seenEndToEnd = new Map();

    txList.forEach((tx, txIdx) => {
      const txPath = `${pmtPath}/CdtTrfTxInf[${txIdx + 1}]`;
      const txPmtTpInf = firstChild(tx, 'PmtTpInf');
      const txInstrPrty = txPmtTpInf ? textOf(firstChild(txPmtTpInf, 'InstrPrty')) : '';
      const txSvcLvl = txPmtTpInf ? textOf(path(txPmtTpInf, 'SvcLvl') && firstChild(path(txPmtTpInf, 'SvcLvl'), 'Cd')) : '';
      const txChrgBr = textOf(firstChild(tx, 'ChrgBr'));

      const effInstrPrty = pmtInfInstrPrty || txInstrPrty;
      const effSvcLvl = pmtInfSvcLvl || txSvcLvl;
      const effChrgBr = pmtInfChrgBr || txChrgBr;

      if (effInstrPrty && effInstrPrty !== 'NORM') {
        addProblem({ code: 'instr_prty_not_norm', severity: 'medium', message: T.instrPrty(txPath, effInstrPrty), path: `${txPath}/PmtTpInf/InstrPrty`, value: effInstrPrty, fix: 'NORM' });
      }
      if (!effSvcLvl) {
        addProblem({ code: 'svc_lvl_missing_or_invalid', severity: 'high', message: T.svcLvlChyba(txPath), path: `${txPath}/PmtTpInf/SvcLvl/Cd`, fix: 'SEPA' });
      } else if (effSvcLvl !== 'SEPA') {
        addProblem({ code: 'svc_lvl_missing_or_invalid', severity: 'high', message: T.svcLvlZly(txPath, effSvcLvl), path: `${txPath}/PmtTpInf/SvcLvl/Cd`, value: effSvcLvl, fix: 'SEPA' });
      }
      if (!effChrgBr) {
        addProblem({ code: 'chrg_br_missing', severity: 'medium', message: T.chrgBrChyba(txPath), path: `${txPath}/ChrgBr`, fix: 'SLEV' });
      } else if (effChrgBr !== 'SLEV') {
        addProblem({ code: 'chrg_br_invalid', severity: 'high', message: T.chrgBrZly(txPath, effChrgBr), path: `${txPath}/ChrgBr`, value: effChrgBr, fix: 'SLEV' });
      }

      const pmtId = firstChild(tx, 'PmtId');
      const endToEndEl = pmtId ? firstChild(pmtId, 'EndToEndId') : null;
      const endToEndId = endToEndEl ? textOf(endToEndEl) : '';
      if (!endToEndId) {
        addProblem({ code: 'end_to_end_id_missing', severity: 'high', message: T.e2eChyba(txPath), path: `${txPath}/PmtId/EndToEndId` });
      } else {
        if (endToEndId.length > 35) {
          addProblem({ code: 'end_to_end_id_too_long', severity: 'high', message: T.e2eDlhy(txPath, endToEndId.length), path: `${txPath}/PmtId/EndToEndId`, value: endToEndId, fix: endToEndId.slice(0, 35) });
        }
        const refs = analyzeReferenceSymbols(endToEndId);
        if (refs) {
          if (!refs.orderOk) {
            addProblem({ code: 'reference_symbol_order', severity: 'medium', message: T.symbolPoradie(txPath, endToEndId), path: `${txPath}/PmtId/EndToEndId`, value: endToEndId, fix: refs.canonical });
          }
          if (refs.lengthIssues.length) {
            const limits = { VS: 10, SS: 10, KS: 4 };
            for (const li of refs.lengthIssues) {
              addProblem({ code: 'reference_symbol_too_long', severity: 'medium', message: T.symbolDlhy(txPath, li.kind, li.value, li.value.length, limits[li.kind]), path: `${txPath}/PmtId/EndToEndId`, value: endToEndId });
            }
          }
          if (refs.nonNumericIssues.length) {
            for (const ni of refs.nonNumericIssues) {
              addProblem({ code: 'reference_symbol_non_numeric', severity: 'medium', message: T.symbolNecislo(txPath, ni.kind, ni.value), path: `${txPath}/PmtId/EndToEndId`, value: endToEndId });
            }
          }
        }
        if (seenEndToEnd.has(endToEndId)) {
          addProblem({ code: 'duplicate_end_to_end_id', severity: 'medium', message: T.e2eDuplicita(txPath, endToEndId, seenEndToEnd.get(endToEndId)), path: `${txPath}/PmtId/EndToEndId`, value: endToEndId });
        } else {
          seenEndToEnd.set(endToEndId, txPath);
        }
      }

      const amtEl = firstChild(tx, 'Amt');
      const instdAmtEl = amtEl ? firstChild(amtEl, 'InstdAmt') : null;
      if (!instdAmtEl) {
        addProblem({ code: 'amount_missing', severity: 'high', message: T.sumaChyba(txPath), path: `${txPath}/Amt/InstdAmt` });
      } else {
        const ccy = instdAmtEl.attrs.Ccy || instdAmtEl.attrs.ccy || '';
        const amtText = textOf(instdAmtEl);
        const amtVal = parseAmountText(amtText);
        if (ccy !== 'EUR') {
          addProblem({ code: 'amount_currency_invalid', severity: 'high', message: T.sumaMena(txPath, ccy || T.chybaHodnota), path: `${txPath}/Amt/InstdAmt/@Ccy`, value: ccy, fix: 'EUR' });
        }
        if (amtVal === null) {
          addProblem({ code: 'amount_format_invalid', severity: 'medium', message: T.sumaFormat(txPath, amtText), path: `${txPath}/Amt/InstdAmt`, value: amtText });
        } else {
          if (amtVal <= 0) {
            addProblem({ code: 'amount_non_positive', severity: 'high', message: T.sumaNekladna(txPath, amtText), path: `${txPath}/Amt/InstdAmt`, value: amtText });
          }
          const decMatch = amtText.match(/\.(\d+)$/);
          if (decMatch && decMatch[1].length > 2) {
            addProblem({ code: 'amount_format_invalid', severity: 'medium', message: T.sumaDesatinne(txPath, amtText), path: `${txPath}/Amt/InstdAmt`, value: amtText, fix: fmtAmount(amtVal) });
          }
        }
      }

      const cdtr = firstChild(tx, 'Cdtr');
      const cdtrNmEl = cdtr ? firstChild(cdtr, 'Nm') : null;
      const cdtrNm = cdtrNmEl ? textOf(cdtrNmEl) : '';
      if (!cdtrNm) {
        const severity = bankKey === 'tatrabanka' ? 'medium' : 'high';
        const msg = bankKey === 'tatrabanka' ? T.cdtrNmChybaTatra(txPath) : T.cdtrNmChyba(txPath);
        addProblem({ code: 'cdtr_name_missing', severity, message: msg, path: `${txPath}/Cdtr/Nm` });
      } else {
        if (cdtrNm.length > 70) addProblem({ code: 'cdtr_name_too_long', severity: 'high', message: T.cdtrNmDlhy(txPath, cdtrNm.length), path: `${txPath}/Cdtr/Nm`, value: cdtrNm, fix: cdtrNm.slice(0, 70) });
        reportCharset(cdtrNm, `${txPath}/Cdtr/Nm`);
      }

      const cdtrAcctIban = textOf(path(path(tx, 'CdtrAcct'), 'Id') && firstChild(path(path(tx, 'CdtrAcct'), 'Id'), 'IBAN'));
      let cdtrIbanCheck = null;
      if (!cdtrAcctIban) {
        addProblem({ code: 'cdtr_iban_missing', severity: 'high', message: T.cdtrIbanChyba(txPath), path: `${txPath}/CdtrAcct/Id/IBAN` });
      } else {
        cdtrIbanCheck = checkIban(cdtrAcctIban);
        if (!cdtrIbanCheck.formatOk || !cdtrIbanCheck.lengthOk || !cdtrIbanCheck.checksumOk) {
          addProblem({ code: 'cdtr_iban_invalid', severity: 'high', message: T.cdtrIbanZly(txPath, cdtrAcctIban, !cdtrIbanCheck.formatOk ? T.ibanFormat : !cdtrIbanCheck.lengthOk ? T.ibanDlzka(cdtrIbanCheck.country) : T.ibanSucet), path: `${txPath}/CdtrAcct/Id/IBAN`, value: cdtrAcctIban });
        } else {
          if (cdtrIbanCheck.country === 'SK') {
            const mod11 = skModulo11Ok(cdtrIbanCheck.value);
            if (mod11 === false) {
              addProblem({
                code: 'cdtr_iban_sk_modulo11_failed',
                severity: bankKey === 'tatrabanka' ? 'high' : 'low',
                message: T.cdtrIbanMod11(txPath, cdtrAcctIban, bankKey === 'tatrabanka'),
                path: `${txPath}/CdtrAcct/Id/IBAN`,
                value: cdtrAcctIban,
              });
            }
          } else if (!cdtrIbanCheck.isSepaCountry) {
            addProblem({ code: 'cdtr_iban_outside_sepa', severity: 'medium', message: T.cdtrIbanMimoSepa(txPath, cdtrAcctIban, cdtrIbanCheck.country), path: `${txPath}/CdtrAcct/Id/IBAN`, value: cdtrAcctIban });
          }
        }
        recordDetectedBank(cdtrIbanCheck.value);
      }

      const cdtrAgt = firstChild(tx, 'CdtrAgt');
      const cdtrAgtBicPole = bicZFinInstnId(path(cdtrAgt, 'FinInstnId'));
      const cdtrAgtBic = cdtrAgtBicPole.hodnota;
      const cdtrBicTag = cdtrAgtBicPole.znacka;
      if (!cdtrAgtBic) {
        if (bank.cdtrBicPolicy === 'mandatory') {
          addProblem({ code: 'cdtr_bic_missing_required', severity: 'high', message: T.cdtrBicPovinny(txPath, cdtrBicTag), path: `${txPath}/CdtrAgt/FinInstnId/${cdtrBicTag}` });
        } else if (bank.cdtrBicPolicy === 'derivable') {
          if (cdtrIbanCheck && cdtrIbanCheck.formatOk && !cdtrIbanCheck.isSepaCountry) {
            addProblem({ code: 'cdtr_bic_missing_required', severity: 'high', message: T.cdtrBicMimoSepa(txPath, cdtrBicTag), path: `${txPath}/CdtrAgt/FinInstnId/${cdtrBicTag}` });
          } else {
            checklist.push(T.chkBicOdvodi(bank.label, txPath));
          }
        } else if (bank.cdtrBicPolicy === 'optional') {
          checklist.push(T.chkBicCsob(txPath));
        }
      } else {
        if (!bicFormatOk(cdtrAgtBic)) {
          addProblem({ code: 'cdtr_bic_format_invalid', severity: 'medium', message: T.cdtrBicFormat(txPath, cdtrBicTag, cdtrAgtBic), path: `${txPath}/CdtrAgt/FinInstnId/${cdtrBicTag}`, value: cdtrAgtBic });
        } else if (cdtrIbanCheck && cdtrIbanCheck.country === 'SK') {
          const bban = cdtrIbanCheck.value.slice(4);
          const bankCode = bban.slice(0, 4);
          const derivedBic = SK_BANK_CODE_TO_BIC[bankCode];
          if (derivedBic && derivedBic.slice(0, 6) !== cdtrAgtBic.toUpperCase().slice(0, 6)) {
            addProblem({ code: 'cdtr_bic_mismatch_iban', severity: 'medium', message: T.cdtrBicNesediIban(txPath, cdtrBicTag, cdtrAgtBic, bankCode, derivedBic), path: `${txPath}/CdtrAgt/FinInstnId/${cdtrBicTag}`, value: cdtrAgtBic, fix: derivedBic });
          }
        }
      }

      const rmtInf = firstChild(tx, 'RmtInf');
      if (rmtInf) {
        const ustrdList = allChildren(rmtInf, 'Ustrd');
        if (ustrdList.length > 1) {
          addProblem({ code: 'rmt_inf_multiple_ustrd', severity: 'low', message: T.viacUstrd(txPath, ustrdList.length), path: `${txPath}/RmtInf/Ustrd` });
        }
        if (ustrdList[0]) {
          const ustrd = textOf(ustrdList[0]);
          if (ustrd.length > 140) {
            addProblem({ code: 'rmt_inf_too_long', severity: 'medium', message: T.ustrdDlhy(txPath, ustrd.length), path: `${txPath}/RmtInf/Ustrd`, value: ustrd, fix: ustrd.slice(0, 140) });
          }
          reportCharset(ustrd, `${txPath}/RmtInf/Ustrd`);
        }
      }

      if (bankKey === 'slsp') {
        const lclInstrmCd = textOf(path(txPmtTpInf, 'LclInstrm') && firstChild(path(txPmtTpInf, 'LclInstrm'), 'Cd')) || textOf(path(pmtTpInf, 'LclInstrm') && firstChild(path(pmtTpInf, 'LclInstrm'), 'Cd'));
        if (!lclInstrmCd) {
          addProblem({ code: 'slsp_instant_flag_absent', severity: 'low', message: T.slspInstant(txPath), path: `${txPath}/PmtTpInf/LclInstrm/Cd` });
        }
      }
    });
  });

  function recordDetectedBank(iban) {
    if (!iban || iban.slice(0, 2) !== 'SK') return;
    const bankCode = iban.slice(4, 8);
    const bic = SK_BANK_CODE_TO_BIC[bankCode];
    const label = Object.values(BANKS).find((b) => b.bic === bic);
    const name = label ? label.label : null;
    if (name && !stats.banksDetected.includes(name)) stats.banksDetected.push(name);
  }

  // currencies actually used
  const currencySet = new Set();
  for (const tx of allTx) {
    const amt = path(firstChild(tx, 'Amt'), 'InstdAmt');
    if (amt && amt.attrs.Ccy) currencySet.add(amt.attrs.Ccy);
  }
  stats.currencies = Array.from(currencySet);

  if (expectedTxCount !== null && expectedTxCount !== actualTxCount) {
    addProblem({
      code: 'expected_tx_count_mismatch',
      severity: 'high',
      message: T.pocetNesedi(expectedTxCount, actualTxCount),
      path: 'CstmrCdtTrfInitn',
      value: String(actualTxCount),
      fix: undefined,
    });
  }

  if (xmlText.length > 1_000_000) {
    addProblem({ code: 'file_too_large', severity: 'low', message: T.suborVelky((xmlText.length / 1024 / 1024).toFixed(2)), path: '' });
  }
  if (actualTxCount > 5000) {
    addProblem({ code: 'too_many_transactions_generic', severity: 'low', message: T.velaTransakcii(actualTxCount), path: '' });
  }

  checklist.push(T.chkPoUprave);
  checklist.push(T.chkVerzia);
  if (bankKey === 'generic') {
    checklist.push(T.chkBezBanky);
  }

  // Termín 15. 11. 2026: štruktúrovaná adresa. Beží až tu, aby sa hlásil
  // po chybách, ktoré blokujú import už dnes.
  const adresy = skontrolujAdresy(documentEl, addProblem, dnes, T);
  stats.adriesSpolu = adresy.spolu;
  stats.adriesZlych = adresy.zle;

  return finish();

  function finish() {
    const sorted = sortProblems(problems);
    const highCount = sorted.filter((p) => p.severity === 'high').length;
    const medCount = sorted.filter((p) => p.severity === 'medium').length;
    const lowCount = sorted.filter((p) => p.severity === 'low').length;

    let status = 'pass';
    if (highCount > 0) status = 'fail';
    else if (medCount > 0 || lowCount > 0) status = 'warn';

    let summary;
    if (status === 'pass') {
      summary = T.zhrnutiePass(bank.label);
    } else if (status === 'fail') {
      const top = sorted.find((p) => p.severity === 'high');
      summary = T.zhrnutieFail(highCount, top.message);
    } else {
      const top = sorted[0];
      summary = T.zhrnutieWarn(medCount + lowCount, top ? top.message : '');
    }

    const fixes = sorted
      .filter((p) => p.fix)
      .map((p) => ({ title: p.message.length > 90 ? p.message.slice(0, 87) + '…' : p.message, value: p.fix, where: p.path }));

    return {
      status,
      summary,
      bank: bankKey,
      expected,
      stats,
      problems: sorted,
      fixes,
      checklist: Array.from(new Set(checklist)),
      disclaimer: T.pravnaPoznamka,
    };
  }
}

/**
 * Standalone helper: the bank-specific expected values without running the
 * full diagnosis (used for a live "expected values" preview as the user
 * picks a bank, before pasting XML).
 */
export function expectedValues(input) {
  const cfg = input && typeof input === 'object' ? input : {};
  const bankKey = ['tatrabanka', 'slsp', 'vub', 'csob', 'generic'].includes(cfg.bank) ? cfg.bank : 'generic';
  const bank = bankInfo(bankKey);
  return {
    bank: bankKey,
    bankLabel: bank.label,
    bankBic: bank.bic,
    schemaNamespace: PAIN_NAMESPACE,
    execWindowDays: bank.execWindowDays,
  };
}

// Also expose as a plain browser global when loaded via <script type="module">.
if (typeof window !== 'undefined') {
  window.SepaDoctor = { diagnose, expectedValues };
}
