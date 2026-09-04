# Pro texty pre SEPA pain.001 Generátor (na vloženie do index.html)

Hotové HTML úryvky pre sekciu Pro a rozšírenie FAQ. Bez pomlčiek, bez emoji.
Free verzia sa nikde nespomína ako obmedzená, len ako "rovnaká ako doteraz".
Pro funkcie sú v texte opísané ako pohodlie navyše pre pravidelné mesačné
používanie, nie ako odomknutie niečoho, čo predtým chýbalo.

Trieda `.kicker` číslo prispôsobte poradiu sekcií v hotovej stránke
(v texte nižšie nechané ako `06`, za existujúcou sekciou `#faq`, ktorá je `05`;
ak Pro pôjde pred FAQ, prečíslujte).

---

## 1. Sekcia Pro (heading, bullety, cena, free-veta, licenčná veta, tlačidlo)

```html
<section id="pro">
  <div class="wrap">
    <p class="kicker">06</p>
    <h2>Pro na 12 mesiacov, pre účtovníka, ktorý to robí každý mesiac.</h2>
    <p class="sub">Generovanie XML aj kontrola pred stiahnutím zostávajú úplne zadarmo, bez limitu na počet platieb, súborov ani stiahnutí, presne ako doteraz. Pro pridáva len pohodlie navyše pre toho, kto hromadné príkazy robí opakovane, každý mesiac.</p>

    <ul class="pro-features">
      <li><b>Uložené profily platiteľov.</b> Názov firmy, IBAN, BIC a banku si uložíte raz, nabudúce ich len vyberiete zo zoznamu. Pridávanie aj mazanie profilov je vo vašom prehliadači.</li>
      <li><b>Viac súborov naraz.</b> Pridajte niekoľko blokov platieb (napríklad tri hárky alebo tri CSV exporty) a vygenerujte buď samostatný XML pre každý blok na postupné stiahnutie, alebo ich zlúčte do jedného príkazu.</li>
      <li><b>Šablóny mapovania stĺpcov.</b> Predvolené priradenie stĺpcov pre exporty z Pohody, Omegy (KROS), Money S3 a univerzálny Excel export: namiesto ručného priraďovania každého stĺpca len skontrolujete predvyplnený návrh.</li>
      <li><b>História príkazov.</b> Posledných 50 vygenerovaných súborov (dátum, počet platieb, suma, banka) uložených vo vašom prehliadači, s možnosťou ktorýkoľvek znovu stiahnuť.</li>
      <li><b>Prednostná podpora e-mailom.</b> Otázku k importu alebo mapovaniu vybavíme prednostne, mimo bežnej fronty.</li>
    </ul>

    <p class="pro-price"><b>39 &euro; na 12 mesiacov, jednorazovo.</b> DPH v cene, faktúru po zaplatení pošle Stripe priamo na váš e-mail.</p>

    <p class="pro-licence">Licenčný kľúč vám vydáme hneď po zaplatení. V tomto prehliadači sa aktivuje automaticky; na inom počítači ho jednoducho vložíte ručne.</p>

    <a class="btn btn-solid" href="https://buy.stripe.com/3cIaER9M63hNeFcg8B4ko00" data-umami-event="buy_click" target="_blank" rel="noopener">Kúpiť Pro na 12 mesiacov, 39 &euro;</a>
  </div>
</section>
```

Poznámka k tlačidlu: po úspešnej aktivácii licencie (nie po kliku na kúpu) zavolajte
`umami.track('licence_activated')`, ako je zadané v zadaní. `buy_click` je na samotnom
tlačidle vyššie (`data-umami-event`), to je hotové.

---

## 2. Doplnenie do existujúcej sekcie `#faq` (5 nových `<details>` blokov)

Vložiť za posledný existujúci `<details>` (o odmietnutí súboru bankou), pred
zatvárajúci `</div></section>` sekcie `#faq`.

```html
<details>
  <summary>Čo dostanem v Pro?</summary>
  <p>Uložené profily platiteľov (IBAN, BIC, banka na jeden klik), generovanie viacerých súborov platieb naraz, predvolené šablóny mapovania stĺpcov pre Pohodu, Omegu (KROS) a Money S3, históriu posledných 50 vygenerovaných príkazov so spätným stiahnutím a prednostnú e-mailovú podporu. Samotné generovanie a kontrola XML sú aj naďalej úplne zadarmo, bez zmeny.</p>
</details>
<details>
  <summary>Musím platiť, aby som vygeneroval XML?</summary>
  <p>Nie. Generovanie aj kontrola súboru sú a zostávajú zadarmo, bez limitu na počet platieb, súborov ani stiahnutí. Pro je len pohodlie navyše pre toho, kto hromadné príkazy pripravuje opakovane.</p>
</details>
<details>
  <summary>Ako dostanem faktúru?</summary>
  <p>Faktúru vystaví a pošle na váš e-mail Stripe hneď po zaplatení. Pri tomto predaji je ARLing s. r. o. predajcom cez Stripe Managed Payments: DPH aj vystavenie dokladu rieši priamo Stripe.</p>
</details>
<details>
  <summary>Čo ak zmením počítač?</summary>
  <p>Licenčný kľúč nie je viazaný na jedno zariadenie. Nájdete ho v e-maile od Stripe po zaplatení; na novom počítači ho stačí vložiť ručne do poľa pre licenčný kľúč a Pro sa aktivuje aj tam.</p>
</details>
<details>
  <summary>Čo ak Pro nechcem, môžem dostať peniaze naspäť?</summary>
  <p>Áno. Ak vám Pro nesadne, napíšte do 14 dní od kúpy na <a href="mailto:andrej@arling.sk?subject=Vr%C3%A1tenie%20Pro%20licencie">andrej@arling.sk</a> a peniaze vrátime bez zbytočných otázok.</p>
</details>
```

FAQPage JSON-LD (voliteľné, ak Rola A pridáva Pro otázky aj do
`application/ld+json` bloku pri hlavičke): páry `"name"` / `"acceptedAnswer".text`
zodpovedajú `<summary>` / `<p>` vyššie, v rovnakom poradí.

---

## 3. Text pre zamknutý stav Pro funkcie (ak Rola A potrebuje jednu spoločnú vetu)

Keď používateľ bez licencie klikne na zamknutú Pro funkciu (napr. "Uložiť profil"),
namiesto akéhokoľvek trikového odpočtu alebo falošného limitu:

```html
<p class="pro-locked-hint">Toto je súčasť Pro. <a href="#pro">Pozrite si, čo Pro obsahuje</a>.</p>
```

---

## 4. Krátka veta na použitie kdekoľvek v UI mimo sekcie Pro

Ak Rola A potrebuje jednoriadkový odkaz na Pro (napr. v hlavičke playgroundu
vedľa tlačidla Generovať):

```html
<a href="#pro" class="pro-nav-hint">Pro: uložené profily, viac súborov naraz, história</a>
```
