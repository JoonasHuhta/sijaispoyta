# Sijaispöydän toteutussuunnitelma

## Tavoite

Sijaisvastaava näkee, mitkä tehtävät ovat vielä avoinna, kuka on ilmoittautunut, kuka on vahvistettu ja kuka hoitaa järjestelyä. Oma henkilöstö ja ulkopuolinen sijaispooli käyttävät samaa työnkulkua.

## Vaihe 1 — karvalakkiprototyyppi

Toteutetaan tässä versiossa:

- Henkilön lisäys omaan henkilöstöön tai sijaispooliin, nimi ja lyhyt osaamiskuvaus.
- Päivä- ja aikavälikohtainen saatavuus, saatavuuden poisto.
- Poissaolo ja yksi käsin syötettävä sijaispyyntö: päivä, aika, poissa oleva opettaja, luokka, tehtävä, vastuuhenkilö ja käytännön ohje.
- Sijaisen ilmoittautuminen ja ilmoittautumisen peruminen.
- Sijaisvastaavan vahvistus vain ilmoittautuneelle, saatavilla olevalle henkilölle.
- Päällekkäisten varausten esto yhden tallennetun tilan sisällä.
- Vahvistuksen peruminen avaa tarpeen uudelleen.
- Päivän yhteenveto, kopioitava sijaispyyntö ja JSON-vienti.
- Paikallinen Git, dokumentaatio ja GitHubia varten testityönkulku.

Prototyyppi testataan kuvitteellisilla tiedoilla. Käyttöliittymän roolinvaihto on esittelytoiminto. Työvuoroja tai viestejä ei lähetetä oikeille henkilöille.

## Vaihe 2 — yhteinen koulupilotti

Seuraavan version tärkein muutos on yhteinen palvelin ja tietokanta, ei lisätoiminnot käyttöliittymään.

1. Koulun hyväksymä hosting, nimetty ylläpitäjä ja varmuuskopiointi.
2. Kirjautuminen, sijaisvastaavan ja sijaisen käyttöoikeudet, sijaispooliin kutsuminen.
3. Tietokantaan henkilöt, poissaolot, tunnit, saatavuudet, hakemukset, vahvistukset ja muutoshistoria.
4. Vahvistus palvelimella yhdessä transaktiossa: vain yksi sijainen tehtävään ja vain yksi päällekkäinen tehtävä henkilölle. Samanaikaiset vahvistusyritykset testataan.
5. Poissaolo erotetaan sijaispyynnöstä: koko päivän poissaolo voi avata useita tunteja. Poissaolon peruminen käsittelee myös siihen liittyvät vahvistukset ja ilmoitukset.
6. Saatavuuden muuttaminen ilmoittaa vaikutuksista olemassa oleviin ilmoittautumisiin. Vahvistettujen tehtävien peruutukset vaativat näkyvän käsittelyn.
7. Ulkopuolinen näkee tarjottavat tehtävät ja omat varaukset; sijaisvastaava näkee kokonaisuuden.
8. Yhteinen ilmoittautumislinkki WhatsApp-viestiin. Ensin käsin jaettava viesti, myöhemmin valittu ilmoituskanava.

Valitaan toteutusalusta sen jälkeen, kun koulun tunnukset, ylläpito ja lukujärjestyksen lähde on selvitetty. Tämä demo on tarkoituksella riippuvuuksiltaan pieni ja käyttöliittymä voidaan liittää myöhemmin rajapintaan.

## Vaihe 3 — arjen automaatio

- Lukujärjestyksen tuonti sovitusta lähteestä; muutosten ja poikkeuspäivien hallinta.
- Toistuvat saatavuudet, poikkeukset sekä saatavuustietojen voimassaolo.
- Pääainetuntien ja saman luokan päivän tarjoaminen kokonaisuuksina.
- Kohdennetut ilmoitukset sopivalle joukolle ja muistutus vastaamattomista tarpeista.
- Sijaisuustuntien yhteenveto ja kuormituksen tasainen jakaminen vastuuhenkilön tukena.
- Agentille vain lukuoikeudellinen yhteenvetorajapinta. Raportointi avoimista tarpeista ja poikkeuksista valittuun kanavaan.

## Ilmoitukset

Toteutettu (0.4): sovelluksen sisäiset ilmoitukset tilamuutoksista ja selainilmoitukset avoimella sivulla. Ilmoitukset syntyvät palvelimella samassa tallennuksessa kuin muutos, joten ne eivät voi jäädä tekemättä tai syntyä kahdesti.

Toteutettu (0.5): sähköposti-ilmoitukset henkilökohtaisella kytkimellä ja aamukooste arkiaamuisin klo 7 (GitHub Actions -ajastus → `/api/cron/digest`). Käyttöönotto: README, kohta Ilmoitukset → Käyttöönotto.

Seuraavaksi:

1. **Push-ilmoitus puhelimeen** (Web Push, maksuton): palvelutyöntekijä (service worker), VAPID-avaimet, tilausten tallennus ja lähetys palvelimelta. Android: toimii Chromessa suoraan. iPhone (iOS 16.4+): sivu lisätään ensin kotivalikkoon, minkä jälkeen ilmoitukset voi sallia. Sovelluskauppaa ei tarvita. Sovelluksessa on jo manifesti ja kuvakkeet kotivalikkoon lisäämistä varten.
2. **WhatsApp**: WhatsApp Business Platform, maksullinen viestikohtaisesti. Tarvitaan Meta-yritystili, vahvistettu numero, hyväksytyt viestipohjat ja puhelinnumerot. Viestiin vain aika, luokka ja linkki; ei poissaolon syytä. Siihen asti sijaispyynnön voi kopioida WhatsAppiin käsin.
3. **Varajärjestely aamukoosteelle**: jos Sitesin kirjautuminen estää ajastetut pyynnöt, ajastus siirretään Cloudflaren cron-triggeriin samassa workerissa.

Henkilötiedot ja ilmoitukset pysyvät sovelluksen tietokannassa. Git ja GitHub versioivat vain ohjelman.

## Agentin ja Gitin vastuut

Git versioi ohjelman lähdekoodin, testit ja suunnitelman. Agentti voi tehdä haaran, korjata ohjelmaa, ajaa testit ja tehdä muutosehdotuksen GitHubissa, kun GitHub-yhteys on käytössä.

Sijaistilanne luetaan sovelluksen tietokannasta tai prototyypin JSON-viennistä. Git-commit ei ole henkilöstön saatavuusilmoitus. Ajastus, vastaanottajat ja ilmoituskanava määritellään ennen automaattisten ilmoitusten käyttöönottoa. Sijaisten valinnan vahvistaa tässä mallissa sijaisvastaava.

## Ensimmäisen version hyväksymiskriteerit

- Henkilön voi lisätä molempiin ryhmiin ja hänelle voi merkitä saatavuuden.
- Tarve syntyy poissaolon yhteydessä ja näkyy oikeana päivänä.
- Ilmoittautuminen näkyy odottavana, vahvistus nimettynä sijaisena.
- Osittainen saatavuus, oma poissaolo ja päällekkäinen vahvistus estävät valinnan.
- Vahvistuksen peruminen avaa tehtävän ja vapauttaa sijaisen ajan.
- Selaimen päivitys säilyttää tallennetut tiedot.
- Raportti vastaa käyttöliittymän tilannetta.
- Puhelimen leveydellä lomakkeet ja painikkeet ovat käytettävissä.

## Pilotin mittarit

Seurataan sijaisuuden täyttymiseen kulunutta aikaa, erillisten viestien määrää ja sitä, jäikö joku tehtävä epäselvään tilaan. Ennen koulupilottia sovitaan käytön vastuuhenkilö ja menettely järjestelmän häiriöihin.
