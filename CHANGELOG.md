# Changelog

## 1.0.0 (2026-10-27)

The first release, for the applications API of Latet 0.10.0.

- Credentials **Latet API**: the server's address and an API key's token, tested with a scan of one word.
- Node **Latet** with four operations on a field of each item: **Scan** (where the values are), **Mask** (fakes in
  place of the values), **Unmask** (the values back in place of the fakes) and **Forget** (values out of the key's
  vault for good), with the kind of the texts (prose or data) for Scan and Mask.
- Calls of at most 1,000 items (**Batch Size** lowers it); **Output Field** writes the text to another field.
- The results on each item: findings, replacements and counts, positions in Unicode code points; a text the server did
  not answer has `blocked` and no text; Forget gives one item with `forgotten` and `unknown`.
- Errors with the server's words and what to do; with Continue On Fail, the items of a failed call get `error` and no
  text.
