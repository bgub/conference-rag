# Conference RAG

A Retrieval Augmented Generation (RAG) application that lets users ask questions about General Conference talks using
semantic search and AI-generated answers.

<p align="center">
  <img src="example.png" alt="Conference RAG screenshot" width="600">
  <br>
  <em>Sample screenshot — semantic search with AI-generated answers</em>
</p>

## 🚀 Quick Start

Follow the step-by-step guides in the `steps/` folder:

```
🏁 LAUNCH ──→ 🔐 SIGN IN ──→ 🔍 KEYWORD ──→ 🧠 SEMANTIC ──→ 🤖 RAG ──→ 🚀 YOURS
```

| Step                                 | Milestone        | Topic                                | Time   |
| ------------------------------------ | ---------------- | ------------------------------------ | ------ |
| [00](steps/00_overview.md)           | —                | Overview & Environment Setup         | 15 min |
| [01](steps/01_fork_and_deploy.md)    | 🏁 Launch        | Fork & Deploy to GitHub Pages        | 15 min |
| [02](steps/02_supabase_and_login.md) | 🔐 Sign In       | Supabase Project & Login             | 15 min |
| [03](steps/03_database_schema.md)    | 🔍 Keyword (1/2) | Database Schema & RLS                | 10 min |
| [04](steps/04_scrape_and_import.md)  | 🔍 Keyword (2/2) | Scrape & Import → First green light! | 20 min |
| [05](steps/05_embeddings.md)         | 🧠 Semantic      | Embeddings & Edge Function           | 25 min |
| [06](steps/06_rag.md)                | 🤖 RAG           | RAG Edge Function → All green!       | 15 min |
| [07](steps/07_make_it_yours.md)      | 🚀 Yours         | Add Feature & Reflection             | 20 min |

**Prerequisites:**

- [Supabase](https://supabase.com) account (free tier)
- [GitHub](https://github.com) account
- [OpenAI API key](https://platform.openai.com/api-keys) (~$0.60 usage)
- Python 3.9+
- An AI coding assistant (Antigravity, GitHub Copilot, or Cursor)

## 🤖 AI-Assisted Development

This assignment is designed to be completed with an AI coding assistant. See [Step 00](steps/00_overview.md) for setup
instructions.

Your AI assistant will automatically read [`ai_agent_instructions.md`](ai_agent_instructions.md) to understand the
assignment's learning objectives and teach you along the way.

## 🏗️ Architecture

```text
Browser → Supabase Auth (magic link)
  ├─ Keyword Search → Postgres (RLS)
  ├─ Semantic Search → embed-question → match_sentences()
  └─ Ask a Question → generate-answer
       → Validate session and question
       → OpenAI text-embedding-3-small (1,536 dimensions)
       → match_sentences(): 20 nearest sentences, using caller JWT/RLS
       → Rank talks by mean similarity; load top 3 complete talks
       → OpenAI Responses API (gpt-5-mini)
       → Validate citation IDs → answer + linked source metadata
```

`generate-answer` accepts `{ "question": "..." }`. Retrieval runs on the server; client-supplied `context_talks` is
ignored. The response contains `answer`, `sources` (`id`, `title`, `speaker`, `url`), and `insufficient_evidence`. Only
cited sources are returned. Inline `[1]` references link to source cards. Citation validation checks provenance, not
whether every claim follows from its source. The model is instructed to acknowledge insufficient evidence and use only
retrieved talks.

Both user-facing functions accept authenticated `{ "health": true }` checks without calling OpenAI. Secrets stay in
Supabase environment variables; `ANSWER_MODEL` optionally overrides the default generation model (must support the
Responses API, structured outputs, and minimal reasoning). The existing `OPENAI_API_KEY` is shared.

Deploy from the repository using the Supabase CLI (after `supabase login`):

```bash
supabase functions deploy embed-question --project-ref ksowfdthkxzcycaqihkq
supabase functions deploy generate-answer --project-ref ksowfdthkxzcycaqihkq
```

Run function tests locally:

```bash
deno test --allow-env supabase/functions/embed-question/index_test.ts supabase/functions/generate-answer/index_test.ts
```

## 🔍 Three Search Modes

| Mode                        | What it does                      | Requires                                    |
| --------------------------- | --------------------------------- | ------------------------------------------- |
| **🔍 Keyword Search**       | SQL `ILIKE` query on talk text    | Conference data imported                    |
| **🧠 Semantic Search**      | Vector similarity with pgvector   | Embeddings + `embed-question` Edge Function |
| **🤖 Ask a Question (RAG)** | AI-generated answers with sources | All Edge Functions deployed                 |

## 📁 Project Structure

```
conference-rag/
├── index.html                  # Main application UI
├── app.js                      # Three search modes + auth logic
├── styles.css                  # Dark theme styling
├── config.js                   # Loads config.public.json for browser
├── config.public.json          # Supabase URL + anon key (safe to commit)
├── config.secret.json          # API keys & secrets (git-ignored, YOU create this)
├── config.secret.example.json  # Template for config.secret.json
├── requirements.txt            # Python dependencies
├── .nojekyll                   # Tells GitHub Pages not to use Jekyll
├── steps/                      # Step-by-step assignment guides
│   ├── 00_overview.md
│   ├── ...
│   └── 07_make_it_yours.md
├── scripts/                    # Pipeline scripts (run in order)
│   ├── 01_create_schema.py     # Create DB schema
│   ├── 02_scrape_data.py       # Scrape conference talks → scripts/output/talks.json
│   ├── 03_import_data.py       # Import text to Supabase (🔍 keyword!)
│   ├── 04_embed_data.py        # Generate embeddings → scripts/output/ (💰 saved to disk!)
│   ├── 05_update_embeddings.py # Update DB with embeddings (🧠 semantic!)
│   └── output/                 # Intermediate data files (git-ignored)
└── supabase/                   # Edge Functions (YOU create this with supabase init)
    └── functions/
        ├── _shared/            # Shared auth & CORS helpers
        ├── embed-question/     # Converts questions to embeddings
        └── generate-answer/    # Generates AI answers
```

## 🔒 Security Model

| Component         | Security Approach                                             |
| ----------------- | ------------------------------------------------------------- |
| Supabase anon key | Safe to expose in `config.public.json` (protected by RLS)     |
| OpenAI API key    | Server-side only via Edge Functions (in `config.secret.json`) |
| Database access   | Row Level Security policies                                   |
| Transport         | HTTPS enforced by GitHub Pages                                |

## 📚 Learning Objectives

1. **Vector Embeddings** — Representing text as searchable numbers
2. **Semantic Search** — Finding similar content with cosine similarity
3. **RAG Architecture** — Combining retrieval + generation
4. **Edge Functions** — Serverless compute for secure API management
5. **Row Level Security** — User-level data access control
6. **Production Deployment** — Full-stack app on GitHub Pages

## 🎓 Assignment Deliverables

1. GitHub repository URL (your fork)
2. Live deployment URL (GitHub Pages)
3. Screenshot of a working query + answer
4. Your custom feature description
5. Written reflection on security, search, and AI-assisted development

## 🆘 Troubleshooting

| Issue                         | Solution                                                              |
| ----------------------------- | --------------------------------------------------------------------- |
| "Please configure Supabase"   | Update `config.public.json` with your project URL and anon key        |
| Magic link not working        | Add your site URL to Supabase → Authentication → URL Configuration    |
| Magic link email not arriving | Free tier allows only **3 per hour** — wait and try again, check spam |
| Changes don't appear          | Hard refresh (Ctrl+Shift+R) or try incognito window                   |
| Search shows "Not Ready"      | Complete the corresponding step first                                 |
| "Failed to get embedding"     | Deploy Edge Functions and set OPENAI_API_KEY secret                   |
| "Database search failed"      | Run `scripts/01_create_schema.py`                                     |
| No search results             | Import data with `scripts/03_import_data.py`                          |

## 📄 License

Educational use only. Conference talk content is used under fair use for educational purposes.

---

Built with ❤️ for CS 452

## Project deliverables

- Repository: https://github.com/bgub/conference-rag
- Live application: https://bgub.github.io/conference-rag/
- Working RAG screenshot: [docs/rag-query.jpg](docs/rag-query.jpg)

### Custom feature: linked citation viewer and evidence-aware answers

Each generated answer contains numbered citations. Clicking a citation jumps to the corresponding source card; the card
links to the original conference talk and identifies its title and speaker. This lets readers check the original context
rather than taking the generated answer on trust. Only sources cited in the answer appear in the source list.

The server retrieves sources itself and checks that citation IDs refer to those sources. If the model reports
insufficient evidence, the app displays a clear message instead of presenting an unsupported answer. These checks
establish where citations came from; they do not prove every generated claim is correct.

The five personal reflection questions are intentionally left for the student to complete separately.
