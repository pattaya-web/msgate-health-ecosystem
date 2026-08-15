# Airtable field map (from cleaned Grid view exports)

## Table `ID IBO`

Kept for the app:
- `Name` → optional `display_name` (dashboard prefers anonymized `IBO #n`)
- `Phone IBO`
- `Phone Perso (Hushed)`
- `Phone LLC`
- `🔗 Linked LLCs` → link to LLC table

Dropped (never sync to app):
- Mail / Password (PERSO)
- Date of Birth
- SSN
- Address
- Driver License #
- DL Expiration
- Documents

## Table `LLCs`

Kept for the app:
- `LLC Name`
- `IBO` → link to ID IBO
- `EIN`
- `States`
- `Address` (business)
- `Formation Date (US)`
- `Phone`
- `Domain`
- `Desc Business`
- `Desc Product`
- `Bank` → linked banks / names
- `Statuts Bank` → bank status (note: typo "Statuts" in Airtable)

Dropped (never sync to app):
- Mail
- Host
- Mail/Password Host
- Document drive
- Proton Mail/Password

## Relations for Health Ecosystem

```
IBO (ID IBO)
  └── LLC (LLCs) via Linked LLCs / IBO
        └── Bank (+ Statuts Bank)
              └── MID (next CSV)
```

## Live Airtable sync

1. Create a Personal Access Token on Airtable (read access to your base).
2. Put in `.env.local`:

```env
AIRTABLE_API_KEY=pat...
AIRTABLE_BASE_ID=app...
AIRTABLE_IBO_TABLE=ID IBO
AIRTABLE_LLC_TABLE=LLCs
```

3. Restart `npm run dev`.
4. Open **Ecosystem** → button **Sync Airtable**, or Dashboard **Refresh**.

Without keys, the app loads the cleaned seed (your 3 IBOs / 3 LLCs).
With keys, each sync pulls the latest Airtable rows automatically (also every N minutes from Settings → sync frequency).
