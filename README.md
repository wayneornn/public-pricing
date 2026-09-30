# public-pricing

Provider list prices, one table.

```bash
npm install
cp .env.example .env
npm start
```

Open `http://localhost:4180`.

`INVENTORY_MODE=fixture` uses local sample rows. `live` and `hybrid` need the provider keys in `.env`. The page shows each provider's listed price. Order opens that provider's checkout URL when the listing is an exact offer or a prefilled deploy route.

PP Neue Montreal files live in `public/fonts/` and are not committed.
