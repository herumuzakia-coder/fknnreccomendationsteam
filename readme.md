# FKNN Steam Game Recommender

A fast, lightweight Steam game recommendation system powered by **Fuzzy K-Nearest Neighbor (FKNN)** similarity search over TF-IDF feature vectors. Built with vanilla JavaScript and a zero-dependency Node.js server.

**Live Demo → [fknnreccomendationsteam.vercel.app](https://fknnreccomendationsteam.vercel.app)**

---

## Features

- **FKNN Recommendations** — Click any game to instantly get similar titles ranked by cosine similarity
- **Why Similar** — Each recommendation shows the shared TF-IDF features that drive the match
- **Fuzzy Search** — Trigram-based search with prefix and substring matching across 26,000+ games
- **Genre & Tag Filtering** — Searchable dropdown panel filters the catalog by genre or tag (combinable)
- **Light / Dark Mode** — Persisted per-browser via localStorage
- **Recently Viewed** — Strip showing the last 8 games you opened
- **PWA** — Installable progressive web app with service worker caching
- **Infinite Scroll** — Paginated game grid with intersection observer

---

## Algorithm

### TF-IDF + Cosine Similarity

Each game is represented as a sparse TF-IDF vector computed from its tags, genres, and metadata. Only non-zero features are stored (`sparse` array per game).

### Inverted Index

An inverted index maps each feature dimension to the list of games that have a non-zero value there. Similarity computation scans only games sharing at least one feature with the query — reducing the effective search space from 26K games to a few hundred per query.

```
query game sparse vector
  └─ for each non-zero feature f
       └─ invertedIndex[f] → candidate games
            └─ scores[candidate] += query[f] × candidate[f]   (dot product)
sort candidates → top-K results
```

Cold query: ~120ms. Warm (cached): ~1ms.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS, Tailwind CSS (CDN) |
| Backend | Node.js (built-in `http` module) |
| Algorithm | FKNN via TF-IDF sparse vectors + inverted index |
| Dataset | Steam games — 26,548 titles, 352 TF-IDF features |
| Deployment | Vercel (serverless) |
| PWA | Web App Manifest + Service Worker |

---

## Project Structure

```
├── serve.mjs              # Node.js server + FKNN engine
├── index.html             # Single-file PWA frontend
├── sw.js                  # Service worker
├── manifest.json          # PWA manifest
├── vercel.json            # Vercel deployment config
├── assets/
│   ├── steam_preprocessed.csv   # 26K games with TF-IDF features (48 MB)
│   ├── game_index.csv            # Game metadata index
│   ├── tfidf_matrix.npz          # Source TF-IDF matrix (NumPy)
│   └── logo.png                  # App logo
└── screenshot.mjs         # Puppeteer screenshot utility (dev only)
```

---

## Running Locally

**Requirements:** Node.js 18+

```bash
git clone https://github.com/herumuzakia-coder/fknnreccomendationsteam.git
cd fknnreccomendationsteam
node serve.mjs
```

Open **http://localhost:3000**

Server startup takes ~2 seconds to parse the 48 MB CSV and build the inverted index. All subsequent requests are served from memory.

---

## API Reference

| Endpoint | Description |
|---|---|
| `GET /api/games?page=&limit=&genre=&tag=` | Paginated game catalog with optional filters |
| `GET /api/recommend/:appid?k=` | Top-K similar games for a given Steam app ID |
| `GET /api/search?q=` | Fuzzy search by game title |
| `GET /api/genres` | All unique genre values |
| `GET /api/tags` | All tags sorted by frequency |
| `GET /api/random` | Random game |

---

## Deployment

The project is pre-configured for Vercel. Push to `master` triggers an automatic redeploy.

```bash
git add -A
git commit -m "your message"
git push
```

`vercel.json` routes all `/api/*` requests to the `serve.mjs` serverless function and includes the `assets/` folder in the function bundle. Static files (`index.html`, `sw.js`, `manifest.json`, `assets/logo.png`) are served directly from Vercel's CDN.

---

## Dataset

Source: **[Steam Store Games — Nik Davis](https://www.kaggle.com/datasets/nikdavis/steam-store-games)** (Kaggle)

The raw dataset was preprocessed into TF-IDF feature vectors for use with the FKNN engine. Each game entry contains:
- **Metadata**: App ID, name, genres, tags, header image URL, short description
- **Features**: 352-dimensional TF-IDF sparse vector (avg ~30 non-zero values per game)

---

## License

MIT
