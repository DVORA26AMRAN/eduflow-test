# Management Journal Daily Summary PDF font

 * Isolated journal PDF font bundle. Do **not** import unfinished
 * school-registration PDF shared modules.

## Bundled file

| Item | Value |
|------|--------|
| Disk source of truth | `NotoSansHebrew-Regular.ttf` |
| Deploy module | `notoSansHebrewRegular.b64.ts` |
| Family | Noto Sans Hebrew |
| Style | Regular |
| Format | TrueType |
| Upstream | [googlefonts/noto-fonts](https://github.com/googlefonts/noto-fonts) — `hinted/ttf/NotoSansHebrew/NotoSansHebrew-Regular.ttf` |
| License | SIL Open Font License 1.1 — see `OFL.txt` |
| SHA-256 | `a7fa16fffb27bedb060a0866267c29e9859aeb9c21cc33f5b3aaf6eb062eca85` |

## Why base64 embed

Supabase Edge Function API deploy includes the TypeScript module graph only.
A sibling `.ttf` is not uploaded unless Docker `static_files` bundling is used.
Exact TTF bytes are embedded so deploy always has Hebrew glyphs.

Regenerate after replacing the `.ttf`:

```bash
node scripts/generate-management-journal-hebrew-font-module.mjs
```

## Runtime

1. Load embed module bytes
2. Verify SHA-256 (fail closed on mismatch / empty / non-TTF)
3. Embed via pdf-lib + fontkit (Hebrew) + Helvetica (digits/punctuation)
4. Split bidi runs; place Hebrew glyphs right-to-left in **logical** order (one `drawText` per character). Latin digits/punctuation use Helvetica as LTR blocks. Do **not** reverse Hebrew strings before painting — modern PDF viewers re-apply Unicode BIDI and would double-flip reversed strings.
5. Right-align mixed lines and wrap task text

Do not fall back to a non-Hebrew font for Hebrew letters. Latin digits use Helvetica because Noto Sans Hebrew does not reliably include them.
