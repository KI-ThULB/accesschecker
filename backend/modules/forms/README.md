# forms module

This module analyses form controls and reports common accessibility problems.

Checks performed:

- **Label / Accessible Name**: each control must expose an accessible name
  via a `<label>` element, `aria-label`, `aria-labelledby` or similar
  mechanisms. Missing names trigger `forms:label-missing`.
- **Error Binding**: visible error messages should be programmatically linked
  to the field via `aria-describedby` or an appropriate live region. Missing
  associations trigger `forms:error-not-associated`.
- **Required Indicator**: fields marked as required using a visual indicator
  (e.g. `*`) need the `required` attribute or `aria-required="true"`.
  Otherwise `forms:required-not-indicated` is emitted.
- **Grouping**: groups of radio buttons or checkboxes should be wrapped in a
  `<fieldset>` with a `<legend>` or a corresponding ARIA group with a name.
  Missing grouping results in `forms:group-missing-legend`.
- **Autocomplete (advisory)**: common fields are checked for appropriate
  `type`/`autocomplete` tokens and report `forms:autocomplete-missing` when
  suggestions are absent.

The module aggregates statistics such as the number of unlabeled controls or
missing error bindings. A per-control snapshot is written to the artifact
`forms_overview.json`.

The findings follow the common `Finding` type and may be surfaced in both
internal and public reports.
