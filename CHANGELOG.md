# Changelog

## v1.1.0
* Hid the TinyMCE 7 "Get all features" promotion button.
* Fully translated all developer comments, user-facing loading/error states, and code annotations from Italian to English.
* Completely translated, updated, and modernized the `README.md` in English.
* Handed over maintainership/authorship details to PeopleInside.

## v1.0.0
* Renamed plugin from `tinymce-editor` to `modern-editor` to avoid collision with GPM plugins of the same name.
* Changed the "content" field override mechanism from runtime PHP rewrite to dynamic file-based blueprint generation via `onGetPageBlueprints` conforming to Grav's standard `@extends` system.
* Overrides are now automatically generated for EVERY template in the active theme, rather than just the default.
* Visual editor (TinyMCE via CDN) integrated as a Custom Field using a Web Component for Admin Next.
* No manual theme changes are required.
