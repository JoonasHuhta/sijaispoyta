# Sijaispöytä

Suomenkielinen selainprototyyppi steinerkoulun sijaisjärjestelyihin. Mukana oma henkilöstö ja ulkopuolinen sijaispooli. Ensimmäisen version tarkoitus on kokeilla työnkulkua kuvitteellisilla tiedoilla.

## Käynnistä

Tarvitset Node.js:n (versio 22 tai uudempi). Ulkoisia npm-paketteja ei tarvita.

```powershell
cd C:\steiner-ops\sijaispoyta
npm start
```

Avaa selaimessa http://127.0.0.1:4317. Lopeta palvelin Ctrl+C:llä.

```powershell
npm test
npm run report -- --demo
```

## Kokeile viidessä minuutissa

1. Sijaisvastaavan pöydällä on kolme esimerkkisijaisuutta tämän päivän kohdalla.
2. Avaa **Sijaisen näkymä**, valitse Elias Lehto ja ilmoittaudu pääainetunnille.
3. Palaa **Sijaisvastaavan pöydälle**, valitse ilmoittautunut Elias ja vahvista.
4. Peru vahvistus: tarve avautuu uudelleen.
5. Lisää **Henkilöt ja saatavuus** -näkymässä kuvitteellinen sijainen ja hänelle saatavuus.
6. Merkitse oma poissaolo ja sijaispyyntö käsin. Valitse yksi tunti tai yhtenäinen tuntikokonaisuus.
7. Avaa **Tilanneraportti**. **Vie tiedot** lataa JSON-tiedoston agentin tarkasteltavaksi.

## Testiversio kollegalle (GitHub Pages)

Testiversio toimii pelkässä selaimessa ilman kirjautumista ja tietokantaa. Se käyttää samoja sääntöjä kuin palvelin (`server/board.js` ja `public/domain.js`), mutta tiedot tallentuvat vain testaajan omaan selaimeen. Oikean yläkulman **Testaa roolina** -valikosta voi vaihtaa sijaisvastaavan, sijaisen ja opettajan välillä. Ensimmäisellä käynnillä näytetään lyhyt testiohje.

- Paikallisesti: `npm run demo` ja avaa http://127.0.0.1:4318
- GitHubissa: `.github/workflows/pages.yml` ajaa testit ja julkaisee testiversion `gh-pages`-haaraan jokaisella `main`-pushilla. GitHubin asetuksissa **Settings → Pages → Branch: gh-pages / (root)**.
- Käsin: `npm run build:pages` rakentaa version kansioon `_site/`.

Testiversio tunnistetaan osoitteesta (`*.github.io`), parametrista `?demo` tai `data-mode="demo"`-merkinnästä. Sites-julkaisu toimii kuten ennenkin kirjautumisella ja yhteisellä tietokannalla.

## Ilmoitukset

Sovellus tekee ilmoituksen aina, kun sijaisuuden tila muuttuu. Ilmoitukset näkyvät yläkulman kellossa, ja selain voi näyttää ne myös omina ilmoituksinaan (salli kellon kautta).

| Tapahtuma | Kuka saa tiedon |
|---|---|
| Sijainen ilmoittautuu tai perii ilmoittautumisen | Sijaisvastaava |
| Sijainen vahvistetaan | Vahvistettu sijainen ja poissa oleva opettaja |
| Vahvistus perutaan | Sijainen ja poissa oleva opettaja |
| Opettaja merkitsee itse poissaolon | Sijaisvastaava |
| Sijainen ilmoittaa saatavuuden | Sijaisvastaava |

Säännöt ovat tiedostossa `server/board.js` (`notify`). Kukin näkee vain omat ilmoituksensa, eikä oma toiminto tee ilmoitusta tekijälle itselleen.

Testiversiossa ilmoitukset kulkevat saman selaimen välilehtien välillä: avaa sivu kahteen välilehteen ja valitse kumpaankin eri rooli.

### Sähköposti

Jokainen valitsee kellon kautta itse, saako hän ilmoitukset ja aamukoosteen sähköpostiin. Osoitteena on kirjautumistunnukseen liitetty sähköposti. Lähetys tapahtuu palvelimella heti tallennuksen jälkeen (`server/mail.js`). Jokainen ilmoitus merkitään käsitellyksi ennen lähetystä, joten sama viesti ei lähde kahdesti.

### Puhelinilmoitukset (Web Push)

Ilmaisia, eikä sovelluskauppaa tarvita. Jokainen ottaa ne käyttöön omalla laitteellaan kellon kautta (**Ota käyttöön tällä laitteella**). Saman henkilön laitteita voi olla useita. **Lähetä kokeiluilmoitus** varmistaa, että ilmoitus tulee perille.

- **Android, Windows, Mac:** toimii suoraan Chromessa, Edgessä ja Firefoxissa sekä Macin Safarissa.
- **iPhone ja iPad (iOS 16.4+):** avaa sivu Safarissa ja valitse Jaa → **Lisää Koti-valikkoon**. Avaa Sijaispöytä kotivalikon kuvakkeesta ja ota ilmoitukset käyttöön kellosta. Sovellus neuvoo tämän itse.

Ilmoitus tulee, vaikka Sijaispöytä olisi kiinni. Napautus avaa suoraan kyseisen päivän ja sijaisuuden. Myös aamukooste tulee lyhyenä puhelinilmoituksena niille, joilla push on käytössä. Toteutus on omaa koodia ilman ulkopuolisia palveluja (`server/webpush.js`, `public/sw.js`). Viestit salataan selaimen avaimella (RFC 8291), ja palvelin lähettää vain tunnettuihin selainvalmistajien push-palveluihin. Vanhentuneet laitetilaukset poistuvat automaattisesti.

Testiversiossa ilmoitus näkyy, kun sivu on auki tai taustalla. Oikeassa versiossa se tulee palvelimelta, vaikka sovellus olisi kokonaan kiinni.

### Aamukooste ("agentti")

Arkiaamuisin klo 7 GitHub Actions (`.github/workflows/digest.yml`) herättää sovelluksen. Sovellus kokoaa tilanteen omasta tietokannastaan (`server/digest.js`):

- **Sijaisvastaava:** tämän päivän ja seuraavan koulupäivän sijaisuudet. Ensin vahvistamattomat, ja kunkin kohdalla ilmoittautuneet ja käytettävissä olevat.
- **Sijainen:** muistutus päivän sijaisuuksista ohjeineen sekä seuraavan koulupäivän sijaisuudet.
- **Poissa oleva opettaja:** kuka sijaistaa, tai tieto että sijaista ei ole vielä vahvistettu.

Hiljaisena aamuna viestiä ei lähetetä. Kooste lähtee kerran päivässä. GitHubin kautta ei kulje henkilötietoja, sillä vastaus sisältää vain lukumääriä. Koosteen voi esikatsella sovelluksessa painikkeella **Aamukooste**.

### Käyttöönotto

1. Luo tili sähköpostipalveluun [Resend](https://resend.com) ja vahvista lähettäjän verkkotunnus (esim. koulun oma).
2. Lisää Sites-julkaisun salaisuuksiin (samaan paikkaan kuin `ADMIN_EMAIL`):
   - `RESEND_API_KEY`: Resendin API-avain
   - `MAIL_FROM`: esim. `Sijaispöytä <sijaispoyta@koulu.fi>`
   - `SITE_URL`: sovelluksen osoite viestien linkkejä varten
   - `CRON_TOKEN`: pitkä satunnainen merkkijono (vähintään 24 merkkiä)
3. Puhelinilmoituksia varten: aja `npm run push:keys` ja lisää tulostuvat `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` ja `VAPID_SUBJECT` samoihin Sites-salaisuuksiin. Puhelinilmoitukset toimivat myös ilman sähköpostia.
4. Lisää GitHubiin (Settings → Secrets and variables → Actions) `SIJAISPOYTA_URL` ja `SIJAISPOYTA_CRON_TOKEN` (sama kuin `CRON_TOKEN`).
5. Testaa: Actions → Aamukooste → Run workflow (esikatselu ei lähetä mitään).

Ajastettu pyyntö tulee ilman ChatGPT-kirjautumista ja tunnistetaan `CRON_TOKEN`illa. Jos Sites ohjaa kaikki kirjautumattomat pyynnöt kirjautumiseen, ajastus ei tavoita sovellusta. Silloin aamukooste ajetaan Cloudflaren omalla ajastuksella tai muulla palvelimella (ks. PLAN.md).

## Ulkoasu

Värit tulevat koulun logosta (`public/img/logo.png`): sininen toiminnoille, punainen avoimille, keltainen vahvistusta odottaville ja vihreä vahvistetuille sijaisuuksille.

## Version 0.1 rajat

- Tiedot tallentuvat vain kyseisen selaimen localStorageen. Eri tietokoneet ja eri verkko-osoitteet eivät jaa tietoja.
- Näkymien ja henkilöiden vaihtaminen on demotoiminto, ei kirjautuminen tai käyttöoikeusrajaus. Käytä vain kuvitteellisia tietoja.
- Samassa selaimessa välilehdet päivittyvät toistensa muutoksista, mutta tallennus ei ole monikäyttäjäjärjestelmän atominen varaus. Tuotantoversiossa vahvistus tehdään tietokantatransaktiossa.
- Poissaolon aikaväli on sama kuin käsin avattu sijaispyyntö. Koko päivän poissaolo, yksittäiset tunnit ja lukujärjestys erotetaan seuraavassa versiossa.
- Saatavuus on päiväkohtainen. Pätevyyttä tai soveltuvuutta ei arvioida automaattisesti.
- Saatavuuden puuttuminen tarkoittaa "ei ilmoitettu", ei varmistettua estettä. Vahvistaminen vaatii kuitenkin kattavan ilmoitetun saatavuuden ja ilmoittautumisen.
- WhatsApp-painike tuottaa kopioitavan viestin. Automaattisia viestejä, yhteistä ilmoittautumislinkkiä tai taustalla toimivaa agenttia ei ole.
- Lähdekoodi voidaan pitää Gitissä; oikeat henkilöstötiedot, yhteystiedot ja poissaolot kuuluvat käyttöoikeuksin suojattuun sovellustietokantaan.

## Agentin käyttö

Agentti voi tarkastaa muutokset Gitistä, tehdä korjauksia omassa haarassaan, ajaa testit ja valmistella muutokset katselmointiin. Ajantasainen sijaisraportti tarvitsee sovellustiedot, joita Git ei itsessään sisällä.

Vie prototyypin tiedot, siirrä tiedosto paikalliseen `data/`-kansioon ja aja:

```powershell
npm run report -- data/sijaispoyta-2026-11-13.json 2026-11-13
```

`data/` ja `exports/` ovat Gitin ulkopuolella. Raportti on viedyn tiedoston tilannekuva, ei reaaliaikainen yhteys selaimeen. Agentille voi antaa ohjeen:

> Lue data-kansioon viemäni sijaisraportti. Kerro valitun päivän vahvistamattomat tehtävät, ilmoittautuneet ja puuttuvat vastuuhenkilöt. Perusta raportti vain tähän tiedostoon. Näytä yhteenveto tässä keskustelussa.

Jatkossa read-only-rajapinta mahdollistaa ajantasaiset raportit. Ajastetut tarkistukset ja ilmoituskanava sovitaan erikseen.

## Git ja GitHub

- GitHub: https://github.com/JoonasHuhta/sijaispoyta (etänimi `github`)
- Testiversio: https://joonashuhta.github.io/sijaispoyta/
- Sites-julkaisun `origin` on palvelun oma lähdekoodivarasto, ei tämä GitHub-repo.

Paikallisesta kansiosta: `git remote add github https://github.com/JoonasHuhta/sijaispoyta.git`, sitten `git pull github main` tai `git push github main`. GitHubin Actions ajaa testit ja päivittää testiversion jokaisella `main`-pushilla.

## Tiedostot

- `public/`: käyttöliittymä (`app.js`, `style.css`, `demo.js` testiversiolle, `img/` logo).
- `server/board.js`: palvelimen käyttöoikeudet ja tallennus.
- `public/domain.js`: saatavuuden, ilmoittautumisen ja vahvistamisen säännöt.
- `tests/`: päällekkäisyyksien, peruutusten ja tilasiirtymien testit.
- `scripts/report.mjs`: agentin luettavissa oleva tekstiraportti JSON-viennistä.
- `PLAN.md`: toteutusvaiheet ja hyväksymiskriteerit.

Sovellus toimii myös ilman Google Fonts -yhteyttä järjestelmäfontilla. Sovelluksen tiedot eivät välity fonttipyyntöihin.
