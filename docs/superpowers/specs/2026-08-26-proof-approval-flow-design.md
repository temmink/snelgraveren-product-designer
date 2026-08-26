# ProductForge — Proefdruk- en goedkeuringsstroom (Pro)

_Ontwerp vastgesteld 2026-08-26. Bouwt voort op 1.9.0 (`Admin\DesignsPage`, ontwerp toewijzen aan
een klant)._

## Doel

De winkelier maakt zelf een ontwerp voor een klant, stuurt het als proefdruk, en de klant keurt het
goed door het te bestellen — of vraagt een wijziging aan. Vandaag kan alleen het eerste deel: een
ontwerp toewijzen. De klant krijgt dan de volledige editor, kan alles veranderen, en er is geen
moment waarop iemand "akkoord" zegt.

**Kernprobleem dat dit oplost:** wat de klant goedkeurt moet exact zijn wat de laser krijgt. De
designer rendert het canvas opnieuw in de browser van de klant, en die render is aantoonbaar niet
altijd gelijk — in 1.3.5 laadde een Google-font niet op live en kwam de tekst scheef uit de export.
Een proefdruk die opnieuw rendert, laat de klant dus iets anders goedkeuren dan wat er gemaakt
wordt.

## Uitgangspunten

Vastgelegd in overleg, 2026-08-26:

| Vraag | Keuze |
|-------|-------|
| Klant wil een wijziging | Ontwerp staat op slot; klant vraagt de wijziging aan bij de winkelier |
| Account nodig | Nee — ondertekende tokenlink, inloggen pas bij het afrekenen |
| Wie mailt | De plugin, met knop vanuit het Designs-scherm |
| Wat betekent akkoord | In de winkelwagen en afrekenen (bestaande WooCommerce-stroom) |
| Free of Pro | **Pro** |

## 1. Architectuurkeuze: de proefdruk is een afbeelding, geen canvas

Overwogen en verworpen:

- **De bestaande designer in kijkmodus.** Hergebruikt alles, maar rendert opnieuw in de browser van
  de klant — precies het risico hierboven. Bovendien is "op slot" in Fabric een claim die je
  permanent moet bewaken; elke nieuwe functie kan er een gat in maken.
- **Als WooCommerce-concept-bestelling met betaallink.** Hergebruikt Woo's mail en betaalpagina,
  maar maakt een bestelling vóórdat de klant ja zei, vervuilt het orderoverzicht met onbetaalde
  regels, en botst met de gekozen betekenis van "akkoord".

**Gekozen:** een eigen, serverside gerenderde proefdrukpagina zonder Fabric en zonder JS-bundel, die
de opgeslagen render toont — het bestand dat de productie krijgt. Bijkomend voordeel: laadt direct
op een telefoon, en er is geen editor die per ongeluk bewerkbaar kan worden, want er is geen editor.

## 2. Gegevensmodel

`Database\Migration1100` voegt vier kolommen toe (de reeks staat al op 1000) aan `wp_pf_designs`:

```sql
proof_status   ENUM('none','sent','changes_requested','approved') NOT NULL DEFAULT 'none',
proof_token    CHAR(32)  NOT NULL DEFAULT '',
proof_sent_at  DATETIME  NULL,
proof_note     TEXT      NULL,
proof_email    VARCHAR(191) NOT NULL DEFAULT '',
KEY proof_token (proof_token)
```

De bestaande kolom `status` (`draft|final|ordered|archived`) blijft ongemoeid: die beschrijft de
levenscyclus voor export en statistieken. Een proefdruk is een parallelle toestand, geen fase in
diezelfde reeks — een goedgekeurde proefdruk is nog steeds een `draft` tot de bestelling binnen is.

`proof_email` is nodig omdat een proefdruk naar iemand **zonder account** kan gaan — dat is een
uitgangspunt van dit ontwerp — en het adres dan niet uit `customer_id` te herleiden is.

`proof_token` is `bin2hex(random_bytes(16))`, dezelfde bron als `design_hash`. Bewust een aparte
waarde: de hash lekt in winkelwagen-URL's en ordermeta, en mag daarom geen toegang geven.

## 3. Toestandsmachine

| Van | Actie | Naar | Bijwerking |
|-----|-------|------|------------|
| `none`, `sent`, `changes_requested`, `approved` | winkelier: **Stuur proefdruk** | `sent` | token aanmaken als leeg; `proof_sent_at` = nu; mail naar klant |
| `sent`, `changes_requested` | klant: **Goedkeuren** | `approved` | hash in WC-sessie; in winkelwagen; mail naar winkelier |
| `sent` | klant: **Wijziging aanvragen** | `changes_requested` | `proof_note` opslaan; mail naar winkelier |
| elke | winkelier: **Trek in** | `none` | token wissen — de link is dood |

Goedkeuren mag ook vanuit `changes_requested`: de klant die een wijziging vroeg en zich bedenkt,
kijkt naar precies wat hij zou krijgen, dus dat alsnog accepteren is legitiem. Verbieden zou hem
laten vastzitten tot de winkelier iets doet — de governing rule uit CLAUDE.md.

Opnieuw sturen mag ook vanuit `sent` zelf: de winkelier kan het ontwerp aanpassen en opnieuw sturen
voordat de klant heeft gereageerd. Elke andere overgang wordt geweigerd, behalve één opzettelijke
uitzondering: `ProofWorkflow::approve()` op een proefdruk die al `approved` is, is een no-op (geen
fout) — de tweede klik op **Goedkeuren en bestellen** (dubbele klik, F5, de terugknop, of de knop
"Probeer opnieuw" na een mislukte winkelwagen-toevoeging) stuurt de klant gewoon door naar de kassa,
idempotent, net als de eerste keer. De melding "je hebt dit al goedgekeurd" met een knop naar de
winkelwagen is GEEN reactie op die knop — hij verschijnt alleen wanneer de klant de proefdrukpagina
zelf opnieuw opent (een gewone paginalading, geen POST) nadat al is goedgekeurd.
Een ingetrokken of onbekend token geeft een nette pagina ("deze proefdruk is niet meer geldig"), geen
WordPress-404 — de klant moet kunnen zien dát het aan de link ligt.

Alle overgangen leven in één klasse, `Proof\ProofWorkflow`. Er zijn geen REST-endpoints voor
proefdrukken — de proefdrukpagina rendert server-side en roept alleen `ProofWorkflow` en
`Admin\DesignsPage` aan; geen van beide bevat zelf `if`-ketens over toestanden.

## 4. De proefdrukpagina

**URL:** `https://<site>/?sgpd_proof=<token>`, afgevangen op `template_redirect`.

Bewust **geen** `add_rewrite_endpoint`: dat vereist een `flush_rewrite_rules()`, en die heeft op deze
site al eens de shopcategoriepagina's op 404 gezet (zie CLAUDE.md → Deployment). Een query-parameter
heeft geen rewrite-regels nodig en kan dus niets breken.

**Inhoud:**

- per view de opgeslagen `thumbnail` (publieke PNG in `uploads/pf-thumbnails/`, laadt direct)
- per view "toon op ware grootte" → `?sgpd_proof=<token>&sgpd_view=<n>`, afgevangen op dezelfde
  `template_redirect`, dat na tokencontrole de gedecodeerde `export_svg` streamt met het juiste
  content-type en `Content-Disposition: inline` (nooit als download — het is een proefdruk, geen
  productiebestand)
- productnaam en prijs
- knop **Goedkeuren en bestellen**
- knop **Wijziging aanvragen**, die een tekstvak openklapt

`export_svg` is een `data:image/png;base64,`-blob van rond de 580 KB per view (gemeten op een echt
ontwerp). Die inline in de HTML zetten maakt de pagina op een telefoon onbruikbaar; daarom de
thumbnail op de pagina en de volledige render alleen op verzoek.

**Cachen:** de pagina roept `Frontend::prevent_page_cache()` aan, net als de designerpagina. Een
publiek gecachte proefdruk zou de ene klant het ontwerp van de andere tonen — hetzelfde lek dat op
deze site al eens is opgetreden met LiteSpeed.

**Opmaak:** eigen sjabloon met de `pf-`-prefix en `all: initial` op de wrapper, zoals de designer,
zodat het thema de pagina niet kan verbouwen.

## 5. Goedkeuren → winkelwagen

De enige plek waar dit ontwerp aan bestaande beveiliging komt.

1. `proof_status = approved`
2. hash toevoegen aan de WooCommerce-sessie: `sgpd_proof_approved[] = $hash`
3. `WC()->cart->add_to_cart($product_id, 1, 0, [], ['pf_design_hash' => $hash])`, maar alleen als het
   ontwerp nog niet in de winkelwagen zit — dezelfde hash op hetzelfde product levert dezelfde
   cart-id, en WooCommerce verhoogt dan de aantallen. Twee keer klikken zou twee keer rekenen.
4. doorsturen naar de kassa — **alleen als het toevoegen lukte**. Mislukt het (product uit voorraad,
   in de prullenbak, of een veto van een andere plugin), dan is de proefdruk al goedgekeurd en zou
   de klant met een lege winkelwagen achterblijven zonder weg terug. Bij mislukking dus terug naar
   de proefdrukpagina met een leesbare melding en een knop om het opnieuw te proberen.

`Frontend::owns_design()` krijgt één extra clausule, met TWEE voorwaarden: de hash staat in die
sessielijst **én** het ontwerp zelf staat nog op `proof_status = 'approved'`. De sessie bewijst dat
déze bezoeker heeft goedgekeurd; de kolom bewijst dat de winkelier de proefdruk sindsdien niet heeft
ingetrokken. Alleen de sessie zou betekenen dat intrekken geen enkel effect heeft op iemand die al
had goedgekeurd.

Let op wat de WooCommerce-sessie wél is: `WC_Session_Handler` schrijft hem geserialiseerd naar
`wp_woocommerce_sessions` met standaard 48 uur houdbaarheid en een blijvende cookie. De toekenning
overleeft dus een browserherstart en staat wel degelijk in de database — er lekt niets naar een
andere bezoeker, maar "verdwijnt na het bezoek" is onjuist.

**Alleen daar, niet in `RestDesigns::owns_design()`.** De proefdrukpagina wordt serverside
gerenderd en raakt de REST-laag niet aan, dus die blijft zo strak als hij is. De twee methodes zijn
elkaars spiegel en dat is opzettelijk; deze afwijking is de uitzondering en hoort als zodanig in de
docblock van beide te staan, met de reden erbij.

## 6. Wijziging aanvragen

Tekstvak van maximaal 1000 tekens, `sanitize_textarea_field`, opgeslagen in `proof_note`, gevolgd
door een mail aan de winkelier. Rate limit van 5 verzoeken per uur per token via een transient,
hetzelfde patroon als de uploadlimiet — de pagina is zonder inloggen bereikbaar, dus het formulier
moet niet als spamkanaal te gebruiken zijn.

Het verzoek is zichtbaar in de rij van het Designs-scherm. De winkelier past het ontwerp aan (opent
het gewoon in de designer, dat mag hij op grond van `edit_sgpd_templates`) en klikt **Stuur
opnieuw**: dezelfde link, de nieuwe versie erachter. `proof_note` blijft staan tot het volgende
verzoek, zodat je bij het aanpassen nog kunt lezen wat er gevraagd was.

## 7. E-mails

Drie `WC_Email`-subklassen, geregistreerd via `woocommerce_email_classes`:

| Klasse | Aan | Wanneer |
|--------|-----|---------|
| `ProofReadyEmail` | klant | winkelier stuurt (of herstuurt) de proefdruk |
| `ProofChangesRequestedEmail` | winkelier | klant vraagt een wijziging |
| `ProofApprovedEmail` | winkelier | klant keurt goed |

Ontvanger van de twee winkeliersmails: de recipient-instelling van de e-mail zelf, die net als
Woo's eigen beheerdersmails standaard op `admin_email` staat en per mail te wijzigen is.

Als `WC_Email` verschijnen ze onder WooCommerce → Instellingen → E-mails, met dezelfde opmaak als de
andere winkelmails en met de teksten aanpasbaar zonder codewijziging. Sjablonen komen in
`templates/emails/` en zijn overschrijfbaar door het thema, zoals WooCommerce dat doet.

Valt WooCommerce weg, dan degradeert dit netjes: de klassen worden alleen geregistreerd als
`WC_Email` bestaat, en de knop meldt dat mailen niet beschikbaar is in plaats van fataal te falen.

## 8. Admin: uitbreiding van het Designs-scherm

Op `Admin\DesignsPage`:

- kolom **Proefdruk**: toestand + datum van versturen
- knoppen **Stuur proefdruk** / **Stuur opnieuw** / **Trek in**, per rij, in dezelfde stijl als
  Assign/Unassign
- het wijzigingsverzoek van de klant zichtbaar in de rij
- filter op proefdruktoestand, zodat "wacht op klant" en "wijziging gevraagd" te scheiden zijn

Terugkoppeling gaat op de rij, niet via `add_settings_error` — deze shop draait Admin Site
Enhancements, dat elke `.notice` in een verborgen lade veegt. Zie CLAUDE.md → Handing a design to a
customer.

## 9. Pro-gating

Nieuwe feature-sleutel `proofs` in `Plugin::has_feature()`.

De servercode wordt fysiek gestript uit de gratis build via `@fs_premium_only` in
`snelgraveren-product-designer.php`: `/includes/Proof/`, `/includes/Emails/` en het proefdruksjabloon.
`DesignsPage` blijft in beide builds, dus die moet de proefdrukknoppen achter `has_feature('proofs')`
zetten én de Proof-klassen met `class_exists()` benaderen, precies zoals de bestaande premium-splits
dat doen.

De proefdrukpagina zelf wordt in de gratis build niet geregistreerd. Een bestaande link valt dan
door naar de normale pagina — geen nette melding, want de code die hem zou tonen is er niet meer.
Dat is aanvaardbaar: proefdrukken zijn alleen in Pro te maken, dus dit treft uitsluitend iemand die
van Pro naar gratis terugvalt met openstaande proefdrukken.

## 10. Opruimcron — een valkuil die dit ontwerp introduceert

`Cleanup` verwijdert verlaten gastontwerpen via
`DesignRepository::find_stale_guest_drafts()`: `customer_id = 0 AND status = 'draft'`, ouder dan de
retentie-instelling (standaard 30 dagen). Die query sluit al ontwerpen uit die aan een orderregel of
een exportrecord hangen; een proefdruk moet daar als derde uitzondering bij.

Een proefdruk naar iemand **zonder account** is exact zo'n rij. Die zou na een maand verdwijnen,
inclusief de link die de klant nog in zijn mailbox heeft. `find_stale_guest_drafts()` moet
daarom alles met `proof_status <> 'none'` overslaan.

Dit is geen randgeval: "geen account nodig" is een uitgangspunt van dit ontwerp, dus dit is het
normale geval.

## 11. Testen

**PHP-unit** (`tests/php/Proof/`):

- elke geldige overgang uit de tabel in §3, en dat elke ongeldige overgang wordt geweigerd
- goedkeuren vanuit `approved` verandert niets en meldt geen fout
- token is 32 hex, verschilt van `design_hash`, en wordt gewist bij intrekken
- `Frontend::owns_design()` accepteert een hash uit de sessielijst en wijst hem af zodra de
  proefdruk is ingetrokken
- `RestDesigns::owns_design()` accepteert die hash **niet**
- `find_abandoned_guest_designs()` slaat een ontwerp met een proefdruk over
- rate limit blokkeert het zesde wijzigingsverzoek binnen een uur

**Browser, volledige route:** versturen → link openen in een venster zonder sessie → wijziging vragen
→ als winkelier aanpassen en opnieuw sturen → goedkeuren → winkelwagen controleren op hash en
thumbnail → afrekenen → controleren dat de export het goedgekeurde bestand is.

## 12. Bewust niet in scope

- **Geen versiegeschiedenis van proefdrukken.** Eén `proof_note` en één toestand; wie wil weten wat
  er eerder gevraagd was, kijkt in zijn mail.
- **Geen vervaldatum op de link.** Een link die doodgaat vlak voordat de klant klikt is erger dan
  geen link. Intrekken is er wel, en dat is een bewuste handeling.
- **Geen "mijn proefdrukken"-overzicht voor de klant.** De link is genoeg; klanten met een account
  zien het ontwerp al onder Mijn ontwerpen.
- **Geen goedkeuring per view.** Je keurt het ontwerp goed, niet de voorkant apart van de achterkant.
- **Geen betaallink los van de winkelwagen.** Akkoord betekent afrekenen via de normale
  WooCommerce-stroom; dat was een uitgangspunt.

## Openstaand na oplevering

De klant kan na goedkeuring nog steeds via `?pf_design=HASH` de designer openen als het ontwerp op
zijn account staat, en het dan alsnog wijzigen. Voor de tokenroute (zonder account) speelt dit niet.
Of dat afgesloten moet worden — bijvoorbeeld door een goedgekeurd ontwerp alleen-lezen te maken tot
de winkelier het weer vrijgeeft — is een aparte beslissing die pas te nemen is als de stroom in
gebruik is.
