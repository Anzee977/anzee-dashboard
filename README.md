# anzee · polymarket dashboard

Dashboard personnel pour suivre plusieurs comptes Polymarket en parallèle. Lit uniquement des données publiques (Data API + Polygon RPC), aucune clé privée requise.

## Métriques affichées

Pour chaque funder address :
- **Total balance** — somme des positions ouvertes (valeur courante) + USDC libre
- **Free USDC** — solde USDC.e sur le proxy wallet (lu sur Polygon RPC)
- **Volume all-time** — somme `usdcSize` de tous les trades depuis l'origine
- **Volume 24h** — idem, fenêtre roulante 24h
- **LP rewards all-time** — somme des events `REWARD` (les rewards LP arrivent dans l'activity)
- **LP rewards 24h** — idem 24h

Plus une barre de totaux agrégés en haut de page.

## Stack

- Next.js 14 (App Router) + TypeScript
- SWR pour le caching + auto-refresh
- viem pour l'appel RPC Polygon (balance USDC)
- Aucune base de données — les adresses sont stockées en `localStorage` côté navigateur

## Sources de données

| Métrique | Endpoint |
|---|---|
| Positions ouvertes | `GET data-api.polymarket.com/positions?user={addr}` |
| Activité (trades + rewards) | `GET data-api.polymarket.com/activity?user={addr}` |
| Balance USDC | Polygon RPC, `USDC.balanceOf(addr)` à `0x2791Bca1...` |

L'adresse à utiliser est le **proxy wallet** affiché sur [polymarket.com/settings](https://polymarket.com/settings), pas l'EOA Magic.

## Installation locale

```bash
pnpm install        # ou npm install / yarn
pnpm dev
```

Ouvre http://localhost:3000.

## Variables d'environnement

Une seule, et elle est optionnelle :

```bash
# .env.local
POLYGON_RPC_URL=https://polygon-rpc.com
```

Le RPC public par défaut a un rate limit faible. Pour 4-10 comptes en auto-refresh 1m c'est suffisant, mais si tu vois des `429` pense à un RPC dédié (Alchemy/Infura/Ankr free tier).

## Déploiement Vercel

```bash
npm i -g vercel
vercel
```

Vercel détecte Next.js automatiquement. Au premier run il crée le projet. Ensuite :

1. Va sur `vercel.com/dashboard` → ton projet → Settings → Domains
2. Ajoute `dash.anzee.xyz` (ou `anzee.xyz` directement)
3. Vercel te donne soit un enregistrement A (`76.76.21.21`) pour la racine, soit un CNAME (`cname.vercel-dns.com`) pour un sous-domaine
4. Ajoute ça chez ton registrar de `anzee.xyz`

Sous-domaine recommandé pour garder la racine libre.

## Déploiement VPS Contabo

```bash
ssh theo@173.249.18.38
cd ~ && git clone <ton-repo> anzee-dashboard
cd anzee-dashboard
npm install
npm run build

# Production avec PM2 (ou systemd si tu préfères)
sudo npm install -g pm2
pm2 start npm --name anzee -- start
pm2 save
pm2 startup   # suis l'instruction qu'il affiche
```

Par défaut Next écoute sur `:3000`. Pour exposer sur `dash.anzee.xyz` :

```bash
# Nginx reverse proxy
sudo apt install nginx certbot python3-certbot-nginx
sudo nano /etc/nginx/sites-available/anzee
```

```nginx
server {
    server_name dash.anzee.xyz;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/anzee /etc/nginx/sites-enabled/
sudo certbot --nginx -d dash.anzee.xyz
sudo nginx -t && sudo systemctl reload nginx
```

DNS : crée un A record `dash` → `173.249.18.38` chez ton registrar.

## Confidentialité

Les adresses funder sont stockées **uniquement dans le localStorage du navigateur**. Le serveur Next.js ne reçoit l'adresse qu'au moment où il doit interroger les APIs publiques de Polymarket. Aucune base, aucun cookie, aucun tracking.

Cela dit : Polymarket Data API enregistre l'IP de qui requête (à priori celle du serveur Vercel/VPS, pas la tienne), donc les requêtes sont anonymes du point de vue de Polymarket.

## Limitations connues

- **Polymarket V2 (mars 2026)** : pas de fee maker, donc les rewards LP en USDC apparaissent en events `REWARD` dans `/activity`. Ce qui est déjà capturé par ce dashboard.
- **Account avec énormément de trades** : le paging de `/activity` est plafonné à 20 000 events (40 pages × 500). Très largement assez pour un usage normal. Si un compte dépasse, augmente `MAX_PAGES` dans `lib/polymarket.ts`.
- **USDC bridged vs native** : on lit `USDC.e` (`0x2791Bca1…`), qui est ce que Polymarket utilise. Si tu as du USDC natif (`0x3c499c…`) il n'apparaîtra pas — ce qui est normal puisque Polymarket ne le voit pas non plus.

## Roadmap (si tu veux étendre)

Petites améliorations faciles à brancher dessus :
- PnL réalisé / non réalisé (déjà dans `/positions`, juste à exposer)
- Graphique sparkline de volume sur 7j (récupérer `/activity` sur 7j, group by jour)
- Alertes (volume 24h sous un seuil, rewards qui chutent…)
- Export CSV des trades pour compta
