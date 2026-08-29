# Web sources

Attest queries an external source only in a chat scope that asks for one (**Web** or
**Index + Web**), and only for sources you have not switched off. Manage them under
**Settings → External sources**.

Every source has an activation state:

| Activation | Behaviour                                                            |
| ---------- | -------------------------------------------------------------------- |
| `off`      | Never queried.                                                       |
| `auto`     | Queried when the question suits the source's strengths. The default. |
| `always`   | Queried for every web-scoped request.                                |

DuckDuckGo is active from the first launch, so the web scopes work before you add any key. A source
whose credential fields are empty stays unavailable until you fill them in.

## General search

| Source                     | Key                       | Free tier                                       |
| -------------------------- | ------------------------- | ----------------------------------------------- |
| DuckDuckGo                 | not required              | Free, no key                                    |
| Brave Search               | API key                   | 2,000 queries/month free                        |
| Google Programmable Search | API key + engine ID (cx)  | 100 queries/day free                            |
| Serper.dev                 | API key                   | 2,500 queries free                              |
| SearXNG (self-hosted)      | instance URL, key if used | Free; your own instance with the JSON format on |

## Neural and answer-oriented search

| Source           | Key     | Free tier                      |
| ---------------- | ------- | ------------------------------ |
| Tavily           | API key | 1,000 credits/month free       |
| Exa              | API key | ~1,000 searches/month free     |
| Jina Search      | API key | Free token allowance on signup |
| Firecrawl Search | API key | Free tier credits              |

Jina can also fetch a page, not only search it.

## Academic

| Source           | Key              | Free tier          |
| ---------------- | ---------------- | ------------------ |
| arXiv            | not required     | Free, no key       |
| Semantic Scholar | optional API key | Free, key optional |
| OpenAlex         | not required     | Free, no key       |
| Europe PMC       | not required     | Free, no key       |

These sources are queried with English-language queries.

## Encyclopedia, community, and news

| Source                | Key              | Free tier                          |
| --------------------- | ---------------- | ---------------------------------- |
| Wikipedia             | not required     | Free, no key                       |
| GitHub                | optional token   | Free; 10 requests/min without one  |
| Stack Exchange        | optional app key | Free; 300 requests/day without one |
| Hacker News (Algolia) | not required     | Free, no key                       |
| NewsAPI.org           | API key          | 100 requests/day free (dev tier)   |

## Page fetching

| Source   | Key     | Free tier                                                      |
| -------- | ------- | -------------------------------------------------------------- |
| Zyte API | API key | Pay-as-you-go ($5 trial credit); used as a page-fetch fallback |

Zyte performs no search of its own; it retrieves a page that a direct fetch could not.

## Images

| Source            | Key                   | Free tier          |
| ----------------- | --------------------- | ------------------ |
| Wikimedia Commons | not required          | Free, no key       |
| Openverse         | optional client token | Free, key optional |

Both are used by image search only, never for text results.

## What a source receives

A search provider receives the query text alone. Retrieved vault content, note paths, and embeddings
are never sent to it. Credentials are stored in the plugin settings of your vault and are sent only
to the source they belong to.
