# Modern Editor per Grav 2.0 (Admin Next)

Editor visuale WYSIWYG (basato su [TinyMCE](https://www.tiny.cloud/)) per il campo
contenuto delle pagine, compatibile con **Admin Next** (l'admin di Grav 2.0).

## Installazione

1. **Se avevi installato una versione precedente di questo plugin** (es. con
   nome `tinymce-editor`), **disinstallala prima** per evitare conflitti:
   elimina `user/plugins/tinymce-editor/` (o disinstalla da Admin Next).
2. Estrai il contenuto dello zip dentro `user/plugins/modern-editor/`
   (la cartella finale deve contenere `modern-editor.php` direttamente).
3. Svuota la cache:
   ```
   bin/grav clear-cache
   ```
4. **Fai logout e login di nuovo** in Admin Next (importante: Admin Next
   carica una sola volta, al login, l'elenco dei campi custom disponibili;
   se resti nella vecchia sessione potrebbe non vedere il nuovo plugin).
5. Vai su Admin Next → Plugins e assicurati che **Modern Editor** sia abilitato.
6. Apri una pagina qualsiasi in modifica: il campo "Contenuto" dovrebbe mostrare
   l'editor visuale invece del markdown editor di default.

Non è richiesto nessun comando `composer install` o `npm install`: l'editor
viene caricato direttamente da CDN (jsdelivr) al volo dal browser.

## Come funziona l'override del campo (senza toccare il tema)

Questa è la parte più delicata del plugin, quindi vale la pena spiegarla.

Grav unisce i blueprint di pagina (gli schemi che definiscono i campi del
form di modifica) leggendo file YAML da più cartelle, tramite un meccanismo
chiamato `@extends` + lo stream `blueprints://pages`. Un file può "estendere"
un template esistente (es. `default`, `item`, `blog`) e sovrascrivere solo
i campi che gli interessano, lasciando intatto il resto.

Questo plugin, all'avvio (evento `onGetPageBlueprints`):

1. **Scansiona i template del tuo tema attivo** (tutti i file `.html.twig`
   dentro `templates/` del tema, escludendo `error`, `modular`, `partials`).
2. **Genera automaticamente, in cache** (`cache/modern-editor/blueprints/pages/`),
   un piccolo file YAML per ciascun template trovato, che estende quel
   template e sovrascrive solo il campo `content` con `type: moderneditor`.
3. **Registra quella cartella di cache** nello stream `blueprints://pages`,
   cosi' Grav la unisce esattamente come farebbe con un file scritto a mano
   nel tema.

Il risultato: l'editor visuale appare automaticamente su **tutti** i template
di pagina del tuo tema, presenti e futuri, senza che tu debba scrivere o
copiare nulla a mano. Se cambi le opzioni del plugin (altezza, toolbar, ecc.)
da Admin Next, i file generati vengono rigenerati automaticamente al primo
caricamento successivo.

Se vuoi **escludere** l'editor da un template specifico, o personalizzarlo
diversamente per un singolo template, puoi creare a mano un file con priorità
più alta in `blueprints/pages/<nometemplate>.yaml` dentro questo plugin (la
cartella esiste già, vuota, pronta all'uso) — non è necessario per il
funzionamento di base, è solo per personalizzazioni avanzate.

## L'editor non appare? Come fare debug

1. **Svuota la cache + fai logout/login** (vedi Installazione, punti 3-4).
   Questo risolve la maggioranza dei casi: sia perché i blueprint generati
   vengono ricreati, sia perché Admin Next ricarica il registro dei campi.

2. **Controlla che la cartella sia stata generata**, via SSH/FTP:
   ```
   user/cache/modern-editor/blueprints/pages/
   ```
   Dovresti trovare un file `.yaml` per ogni template del tuo tema (es.
   `default.yaml`, eventualmente `item.yaml`, `blog.yaml`, ecc.) — apri uno
   di questi file e verifica che contenga `type: moderneditor` nella sezione
   `content`. Se la cartella non esiste affatto, il problema è che l'evento
   `onGetPageBlueprints` non sta scattando sul tuo setup (vedi punto 4).

3. **Verifica via API se il blueprint risolto è corretto.** Dalla console
   del browser, loggato in Admin Next sulla pagina di modifica:
   ```js
   fetch(window.__GRAV_API_SERVER_URL + (window.__GRAV_API_PREFIX || '/api/v1') + '/blueprints/pages/default', {
     headers: { 'X-API-Token': window.__GRAV_API_TOKEN || '' }
   }).then(r => r.json()).then(j => console.log(JSON.stringify(j, null, 2)));
   ```
   (sostituisci `default` con il template della tua pagina, se diverso).
   Cerca il campo `content` dentro `tabs.fields.content.fields.content`:
   deve riportare `"type": "moderneditor"`.

4. **Se il file in cache esiste ma il blueprint risolto via API riporta
   ancora `"type": "markdown"`**, significa che il plugin API di Admin Next
   non sta leggendo lo stream `blueprints://pages` nello stesso modo
   dell'admin classico per costruire questo endpoint specifico. In tal caso,
   scrivimi (o apri una issue) cosa restituisce esattamente il punto 3, così
   posso capire dove sta divergendo e correggere di conseguenza — è un'area
   di Grav 2.0 ancora molto nuova e non interamente documentata.

5. **Controlla la console del browser (F12)** sulla pagina di modifica per
   eventuali errori JS, e la tab Network per verificare se parte una
   richiesta verso `cdn.jsdelivr.net/npm/tinymce`. Se il blueprint è corretto
   (punto 3 ok) ma non parte questa richiesta, il problema è nel mount del
   web component, non nel blueprint — caso diverso e più facile da isolare.

## Configurazione

Da Admin Next → Plugins → Modern Editor puoi modificare altezza, toolbar,
menu bar e plugin TinyMCE caricati per tutti i template.

## Dark mode

L'editor rileva automaticamente se Admin Next è in modalità scura (classe
`dark`/attributo `data-theme` su `<html>`, o preferenza di sistema se Admin
Next è su "Auto") e applica lo skin scuro nativo di TinyMCE (`oxide-dark` +
`content_css: dark`). Il cambio di tema dall'interno di Admin Next (Settings
→ Appearance) viene rilevato in automatico e l'editor si ricarica con lo
skin corretto, senza bisogno di ricaricare la pagina.

## ⚠️ Limiti conosciuti

- Il contenuto scambiato con il form è **HTML**, non Markdown.
- TinyMCE viene caricato da CDN pubblico: serve accesso a internet dal
  browser dell'amministratore; se il sito ha una CSP restrittiva sugli
  script esterni, l'editor non si carica.
- Non c'è integrazione con il Media Manager nativo di Grav per le immagini.
- I template modulari (cartella `templates/modular/` del tema) sono
  esclusi dalla generazione automatica: se usi pagine modulari con un campo
  "content" che vuoi convertire allo stesso modo, serve un file manuale in
  `blueprints/pages/` (vedi sopra).
- Questo plugin non è stato testato su un'installazione Grav 2.0 reale
  prima del rilascio: la generazione dinamica dei blueprint è un meccanismo
  ragionato sulla documentazione disponibile, non verificato empiricamente.
- Se vedi in console un 404 verso `/api/v1/thumbnails/<hash>.png`, non è
  causato da questo plugin (il componente non genera mai richieste a
  `thumbnails/`): è probabilmente Admin Next che tenta di generare
  un'anteprima della pagina basata su un'immagine nel contenuto che non è
  più raggiungibile. Non impedisce il funzionamento dell'editor.

## Licenza

MIT
