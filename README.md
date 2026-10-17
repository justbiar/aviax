# Aviax

**Karar veren katman.** OKX AI ajanları için bir karar katmanı: kararlar LLM metninden değil, iki karar modelinin (strands-decider ve laya) olasılık dağılımlarından gelir. Aynı katman iki işte canlı çalışır:

- **Şirket risk masası** (`/decision`): OKX demo hazinesi 10 saniyede bir okunur. Limitleri kod ölçer (yoğunlaşma, rezerv, drawdown, oynaklık, VaR). Müdahale kararını iki model verir; karar tartışmasızsa satış emirleri OKX demo hesabında kademeli olarak uygulanır. İnsana sadece tartışmalı kararlar gider (anlaşmazlık, düşük güven, model ile kural çelişkisi, tam çıkış).
- **Otonom trade ajanı** (`/agent`): parite, yön, boyut, TP/SL ve risk kapısı ayrı ayrı olasılık dağılımı. Spot alım + OCO TP/SL, OKX Agent Trade Kit ile.

Team1 Türkiye × OKX TR Agentic Hackathon, Ankara, 17 Ekim 2026.

## Entegrasyonlar

| | Ne kullanılıyor |
|---|---|
| **OKX** | Agent Trade Kit (`@okx_ai/okx-trade-mcp`, MCP): `market_get_tickers`, `market_get_candles`, `spot_place_order`, `spot_place_algo_order` (OCO), `spot_get_order`. OKX demo (simüle) hesabı. |
| **OKX AI** | Karar katmanı: `POST /api/decision` `{ state, questions }` ve stdio MCP aracı `aviax_decide` (`npm run mcp:decision`). Her ajan aynı sözleşmeyle karar sorabilir. |
| **Avalanche Fuji** | ERC-8004 v1 Identity `0x8004A818BFB912233c491871b3d84c89A494BD9e` ve Reputation `0x8004B663056A597Dffe9eCcC1965A193B7388713`: ajanlar kendi cüzdanlarıyla kaydolur (model + yetki hash'i metadata'da), kapanan işlemler itibar kaydına yazılır. x402 (EIP-3009, Fuji USDC `0x5425890298aed601595a70AB815c96711a31Bc65`) ile ücretli senaryo ve şirket karar endpoint'leri. |
| **Karar modelleri** | Yerel Ollama `/v1/systemone`: `strands-decider` (ana), `laya` (ikinci görüş), ensemble 0.6 / 0.4. OpenRouter isteğe bağlı. |

## Çalıştırma

Gereksinimler: Node 20+, [Ollama](https://ollama.com) (karar modelleri kurulu), OKX demo API anahtarı.

```bash
npm install
ollama serve                 # strands-decider ve laya kurulu olmalı
cp .env.example .env.local   # yoksa aşağıdaki değişkenleri elle oluştur
npm run dev                  # http://localhost:3000
```

Sunum / jüri için production:

```bash
npm run build:prod && npm run start:prod
```

`.env.local` değişkenleri (değerler asla commit edilmez): `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`, `OKX_DEMO=1`, `JEV_PROVIDER=endpoint`, `JEV_BASE_URL`, `JEV_MODEL=strands-decider`, `LAYA_ENDPOINT`, `LAYA_MODEL=laya`, `FUJI_RPC_URL`, `FUJI_PRIVATE_KEY`, isteğe bağlı `OPENROUTER_API_KEY`.

## Sayfalar

- `/` ana sayfa ve filodaki ajanın canlı son turu
- `/decision` şirket risk masası: olasılık alanı, karar dağılımları, emirler, oylama geçmişi ve model karnesi
- `/agent` ajan fırlatma sihirbazı (model, yetki, Fuji kaydı), filo, ajan pazarı (x402)
- `/trade` OKX demo spot ekranı
- `/pitch` sunum

## Güvenlik

- Otonom emir sadece `OKX_DEMO=1` iken gider; hesap başına 45 sn'de tek yürütme, büyük düzeltmeler tur başına limitle kademeli.
- Herkese açık linkte botlar engellenir; ziyaretçi kendi şirketini bağlar ya da sunucuda tutulan salt okunur demo oturumunu kullanır, anahtarlar tarayıcıya gitmez.
