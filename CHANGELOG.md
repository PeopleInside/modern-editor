# v1.1.0
## [unreleased]
1. [](#new)
    * Aggiunto supporto al dark mode: l'editor rileva il tema di Admin Next
      (classe/attributo su html, o preferenza di sistema) e applica lo skin
      scuro nativo di TinyMCE, con aggiornamento automatico al cambio tema live
    * Aggiunta `license_key: 'gpl'` alla configurazione TinyMCE per rimuovere
      il banner "evaluation mode"
    * Il wrapper dell'editor usa ora i CSS custom properties di Admin Next
      (--background, --border, --muted-foreground) per integrarsi visivamente

# v1.0.0
## [unreleased]
1. [](#new)
    * Rinominato da "tinymce-editor" a "modern-editor" per evitare conflitto con plugin GPM omonimo
    * Cambiato meccanismo di override del campo "content": da riscrittura PHP a runtime
      (non funzionante con il plugin API di Admin Next) a generazione dinamica di blueprint
      file-based via onGetPageBlueprints, conforme al meccanismo standard @extends di Grav
    * L'override viene ora generato automaticamente per OGNI template del tema attivo,
      non solo per "default"
    * Editor visuale (TinyMCE via CDN) come Custom Field via Web Component per Admin Next
    * Nessuna modifica al tema richiesta
