# @latet-ai/n8n-nodes-latet

n8n community nodes for the applications API of a [Latet](https://latet.ai) server. Latet finds the personal data
and secrets in a text and replaces each value with a fake, the same fake for the same value every time; it puts the
real values back on the way out. With this node a workflow can mask the texts it sends to a model or a service, and
unmask what comes back.

It needs a Latet server with the applications API (Latet 0.10.0 or later) and an API key's token. A person's
computer token is refused.

Documentation: [n8n](https://docs.latet.ai/applications/n8n/) and [the applications API](https://docs.latet.ai/applications/)
in Latet's documentation, also in [Italiano](https://docs.latet.ai/it/applications/n8n/),
[Deutsch](https://docs.latet.ai/de/applications/n8n/), [Français](https://docs.latet.ai/fr/applications/n8n/) and
[Español](https://docs.latet.ai/es/applications/n8n/).

- [Installation](#installation)
- [Credentials](#credentials)
- [Operations](#operations)
- [What the node writes](#what-the-node-writes)
- [Positions are Unicode code points](#positions-are-unicode-code-points)
- [Errors](#errors)
- [Development](#development)

## Installation

In n8n: **Settings > Community Nodes > Install**, and enter `@latet-ai/n8n-nodes-latet`. See n8n's
[installation guide](https://docs.n8n.io/integrations/community-nodes/installation/).

## Credentials

The **Latet API** credentials hold:

- **Server URL**: the address of your Latet server, such as `https://latet.example.com`.
- **Token**: an API key's token (`latet_key_...`), which the server's administrator makes with
  `latet server keys add` or `latet server keys add-token`.

The node sends the token in the `Authorization: Bearer <token>` header of each call. Use an `https://` address: over
`http://` the token and the texts travel in clear.

n8n tests the credentials with a scan of one word (`POST <server>/_latet/apps/v1/scan` with `{"texts": ["latet"]}`),
which keeps nothing. That test needs the `scan` permission (or `mask`, which brings it): a token that may only unmask
or forget fails it, and still works in the node.

### The permissions a token needs

| Operation | Permission |
| --- | --- |
| Scan | `scan`, or `mask` |
| Mask | `mask` |
| Unmask | `unmask` |
| Forget | `forget`, which is never implied: a token without permissions of its own (an API key's first token) cannot forget |

The administrator chooses them when making a token, for example `latet server keys add-token shop n8n --mask --unmask`,
with `--forget` for Forget. Give a workflow the permissions it uses and no more: a token that may unmask restores every value of the key's vault.

## Operations

Each operation reads a text from a field of each item (**Text Field**, `text` by default) and sends the items to the
server in calls of at most 1,000 texts (**Batch Size** in the options lowers it). 2,500 items make 3 calls.

- **Scan**: where the values are in each text, by type. Nothing is kept: the server's vault learns nothing.
- **Mask**: each text with fakes in place of its values. The same value gets the same fake in every call of the same
  API key, so a model can still tell that two texts name the same person.
- **Unmask**: each text with the real value in place of every fake of the key's vault, whichever call made it. The
  server writes each unmask in its administration log.
- **Forget**: takes values out of the key's vault for good. Each item's **Value Field** (`value` by default) holds one
  value, written exactly as it was masked. A later mask of the same value gives it a new fake, and the old fake is
  restored no more. The answer counts the values the vault knew and those it did not, so a token that may forget
  learns whether a value was in the vault. The server writes each forget in its administration log. An address at a
  company's domain (`mario.rossi@acme.it`) keeps the domain as a value of its own: forgetting the address leaves the
  domain, so the domain part of the old fake still unmasks to `acme.it`; forget `acme.it` too if it should go
  ([forgetting values](https://docs.latet.ai/applications/forget/)).

**Kind** (Scan and Mask) says what the texts are: **Prose**, text people wrote (messages, documents), or **Data**
(logs, records, a program's output). Latet reads them differently. Items of different kinds go in different calls.

Within one call the texts are masked together: a value that a later text of the call teaches the server is masked in
the earlier texts too.

Do not give an AI agent the Unmask operation as a tool: it would hand the model the very values masking keeps from it.

## What the node writes

Each output item is its input item with the results added (its binary data kept):

| Operation | Fields |
| --- | --- |
| Scan | `findings`: `[{type, class, start, end}]`, where the values are in the text; `counts`: `{TYPE: n}` |
| Mask | the masked text in the text field; `replacements`: `[{type, class, start, end}]`, where the fakes are in the masked text; `counts` |
| Unmask | the restored text in the text field; `restored`: how many values were put back |
| Forget | one item for the whole run: `{forgotten, unknown}` |

- **Output Field** (Mask and Unmask, in the options) writes the text to another field and leaves the text field as it
  was.
- A text the server does not answer (its local reviewer stopped it, or its guard against dumps withheld it) has
  `blocked`, the server's reason, which names no value, and `null` in place of its text, so that the text in clear
  goes no further.
- `degraded` (Mask) names what ran weaker on the call, when something did: a detector that could not read a text, or
  `llm-review`.
- `type` is the value's type (`EMAIL`, `PHONE`, `IBAN`, a secret's rule...) and `class` the family of what found it
  (`secret`, `custom`, `identity`, `pii`, `ner`, `llm`, `struct`).

## Positions are Unicode code points

`start` and `end` count Unicode code points (`end` not included), as Python does, not the UTF-16 units of a JavaScript
string index. They differ in a text with characters beyond the Basic Multilingual Plane, such as most emoji: in
`Write to 👩‍💻 mario.rossi@acme.it` the address starts at 13 in code points and at 15 in JavaScript. In a Code node:

```js
const value = Array.from(text).slice(start, end).join('');
```

## Errors

A call the server refuses is an error with the server's words and its HTTP status; the words never quote a text, and
the error never holds the token. With **Continue On Fail** (the node's **On Error** setting), the items of a refused
call get `error` and no text, and the other calls go on; an item with no text in its field gets `error` alone.

| Status | Meaning | What to do |
| --- | --- | --- |
| 401 | The server does not know the token. | Check the credentials. |
| 403 | The token lacks the operation's permission. | Use a token with it. |
| 413, 422 | The call is too large for the server. | Lower **Batch Size**. |
| 429, 503 | Too many calls, or a store of the server did not answer (for Unmask: the administration log did not take it, nothing was restored). | Wait and try again: the node's **Retry On Fail** setting does it. |
| 507 | Mask: the key's vault is full. Nothing was masked. | The administrator raises its limit (`latet server keys limit`). |

The [applications API reference](https://docs.latet.ai/reference/apps-api/) has the whole contract.

## Development

```bash
npm ci
npm run lint
npm run build
npm test
```

`npm test` builds the package and runs the tests in `test/` with Node's test runner against `dist/`. `npm run dev`
starts n8n with the node loaded.

This package was built from [n8n-io/n8n-nodes-starter](https://github.com/n8n-io/n8n-nodes-starter) (MIT,
copyright 2022 n8n).

## License

[MIT](LICENSE.md)
